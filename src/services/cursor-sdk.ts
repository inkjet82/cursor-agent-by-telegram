import {
  Agent,
  AgentBusyError,
  Cursor,
  CursorAgentError,
  type SDKAgent,
  type Run,
} from "@cursor/sdk";
import type { Env } from "../env.js";
import type { AgentMode, DiscoveredSkill, UserState } from "../types.js";
import { SessionStore } from "../store/session-store.js";
import { UserStateStore } from "../store/user-state.js";
import { buildPrompt } from "./skill-inject.js";
import type { ModelCatalog } from "./model-catalog.js";
import type { ModelEnvConfig } from "../config/model-env.js";
import { buildModelSelection } from "./model-selection.js";
import type { SessionRecord } from "../types.js";

function isActiveRunConflict(err: unknown): boolean {
  if (err instanceof AgentBusyError) return true;
  if (err instanceof CursorAgentError) {
    return /already has active run|active run/i.test(err.message);
  }
  return false;
}

function isAgentMissingError(err: unknown): boolean {
  if (err instanceof CursorAgentError && /not found/i.test(err.message)) {
    return true;
  }
  if (err instanceof Error && /not found/i.test(err.message)) return true;
  return false;
}

export interface SdkRunOptions {
  userId: number;
  prompt: string;
  mode: Exclude<AgentMode, "smart">;
  state: UserState;
  pendingSkills: DiscoveredSkill[];
  promptPrefix?: string;
  onAssistantText?: (text: string) => void;
}

export interface SdkRunResult {
  text: string;
  runId: string;
  agentId: string;
  status: string;
}

export class CursorSdkRunner {
  constructor(
    private env: Env,
    private modelConfig: ModelEnvConfig,
    private modelCatalog: ModelCatalog,
    private userStore: UserStateStore,
    private sessionStore: SessionStore,
  ) {}

  private async modelFor(state: UserState) {
    return buildModelSelection(this.modelCatalog, this.modelConfig, state);
  }

  /** 기동 시 stale 세션 정리; 경고 문구 반환(있으면) */
  async validateActiveSession(userId: number): Promise<string | undefined> {
    const state = await this.userStore.get(userId);
    if (!state.activeSessionId) return undefined;

    const session = await this.sessionStore.getById(
      userId,
      state.activeSessionId,
    );
    if (!session) {
      await this.userStore.update(userId, { activeSessionId: undefined });
      return "활성 세션 기록이 없어 해제했습니다. /new 권장.";
    }

    try {
      const probe = await this.resumeAgent(userId, state, session.agentId);
      await probe[Symbol.asyncDispose]();
      return undefined;
    } catch (err) {
      if (!isAgentMissingError(err)) return undefined;
      await this.sessionStore.remove(userId, session.id);
      await this.userStore.update(userId, { activeSessionId: undefined });
      return "로컬 에이전트가 없어 세션을 초기화했습니다. /new 권장.";
    }
  }

  private async purgeActiveSession(
    userId: number,
    state: UserState,
  ): Promise<UserState> {
    if (state.activeSessionId) {
      const session = await this.sessionStore.getById(
        userId,
        state.activeSessionId,
      );
      if (session) {
        await this.safeClearRunsForAgent(
          session.agentId,
          session.workspacePath,
        );
        await this.sessionStore.remove(userId, state.activeSessionId);
      }
    }
    await this.userStore.update(userId, { activeSessionId: undefined });
    return this.userStore.get(userId);
  }

  /** 세션 저장 후 dispose 하지 않은 에이전트 반환 (호출자가 dispose) */
  private async createBoundAgent(
    userId: number,
    state: UserState,
  ): Promise<SDKAgent> {
    const model = await this.modelFor(state);
    const agent = await Agent.create({
      apiKey: this.env.CURSOR_API_KEY,
      model,
      local: {
        cwd: state.workspacePath,
        settingSources: state.skillSettingSources,
      },
    });
    const record = await this.sessionStore.create(
      userId,
      agent.agentId,
      state.workspacePath,
    );
    await this.userStore.update(userId, { activeSessionId: record.id });
    return agent;
  }

  private sendToAgent(
    agent: SDKAgent,
    prompt: string,
    mode: Exclude<AgentMode, "smart">,
    force?: boolean,
  ): Promise<Run> {
    return agent.send(prompt, {
      ...(mode === "plan" || mode === "agent" ? { mode } : {}),
      local: { force: Boolean(force) },
    });
  }

  private async rotateSession(
    userId: number,
    state: UserState,
  ): Promise<UserState> {
    if (state.activeSessionId) {
      await this.sessionStore.remove(userId, state.activeSessionId);
    }
    await this.userStore.update(userId, { activeSessionId: undefined });
    return this.userStore.get(userId);
  }

  async safeClearRunsForAgent(
    agentId: string,
    workspacePath: string,
  ): Promise<boolean> {
    try {
      return await this.clearRunsForAgent(agentId, workspacePath);
    } catch (err) {
      if (isAgentMissingError(err)) return false;
      throw err;
    }
  }

  async clearRunsForAgent(
    agentId: string,
    workspacePath: string,
  ): Promise<boolean> {
    const { items } = await Agent.listRuns(agentId, {
      runtime: "local",
      cwd: workspacePath,
    });
    let cleared = false;
    for (const run of items) {
      if (run.status !== "running") continue;
      if (run.supports("cancel")) {
        await run.cancel().catch(() => {});
        cleared = true;
      } else {
        await Agent.cancelRun(run.id, {
          runtime: "local",
          cwd: workspacePath,
        }).catch(() => {});
        cleared = true;
      }
    }
    return cleared;
  }

  async clearRunsForActiveSession(
    userId: number,
    state: UserState,
  ): Promise<boolean> {
    if (!state.activeSessionId) return false;
    const session = await this.sessionStore.getById(
      userId,
      state.activeSessionId,
    );
    if (!session) return false;
    return this.safeClearRunsForAgent(
      session.agentId,
      session.workspacePath,
    );
  }

  async clearStaleActiveRun(userId: number, workspacePath: string): Promise<boolean> {
    const state = await this.userStore.get(userId);
    return this.clearRunsForActiveSession(userId, {
      ...state,
      workspacePath,
    });
  }

  async createFreshSession(userId: number, state: UserState): Promise<SessionRecord> {
    const cleared = await this.purgeActiveSession(userId, state);
    const agent = await this.createBoundAgent(userId, cleared);
    const agentId = agent.agentId;
    await agent[Symbol.asyncDispose]();

    const after = await this.userStore.get(userId);
    const sessionId = after.activeSessionId;
    if (!sessionId) {
      throw new Error("세션을 저장하지 못했습니다.");
    }

    try {
      const probe = await this.resumeAgent(userId, after, agentId);
      await probe[Symbol.asyncDispose]();
    } catch (err) {
      await this.sessionStore.remove(userId, sessionId);
      await this.userStore.update(userId, { activeSessionId: undefined });
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `로컬 Cursor 에이전트에 연결할 수 없습니다. Cursor IDE 실행·로그인을 확인하세요.\n${detail}`,
      );
    }

    const record = await this.sessionStore.getById(userId, sessionId);
    if (!record) throw new Error("세션 기록을 찾을 수 없습니다.");
    return record;
  }

  private async resumeAgent(
    userId: number,
    state: UserState,
    agentId: string,
  ): Promise<SDKAgent> {
    const model = await this.modelFor(state);
    return Agent.resume(agentId, {
      apiKey: this.env.CURSOR_API_KEY,
      model,
      local: {
        cwd: state.workspacePath,
        settingSources: state.skillSettingSources,
      },
    });
  }

  private async recoverMissingAgent(
    userId: number,
    state: UserState,
  ): Promise<SDKAgent> {
    const cleared = await this.purgeActiveSession(userId, state);
    return this.createBoundAgent(userId, cleared);
  }

  private async openAgent(
    userId: number,
    state: UserState,
  ): Promise<SDKAgent> {
    if (state.activeSessionId) {
      const existing = await this.sessionStore.getById(
        userId,
        state.activeSessionId,
      );
      if (existing) {
        if (existing.workspacePath !== state.workspacePath) {
          await this.userStore.update(userId, { activeSessionId: undefined });
        } else {
          try {
            return await this.resumeAgent(userId, state, existing.agentId);
          } catch (err) {
            if (!isAgentMissingError(err)) throw err;
            await this.sessionStore.remove(userId, existing.id);
            await this.userStore.update(userId, { activeSessionId: undefined });
          }
        }
      } else {
        await this.userStore.update(userId, { activeSessionId: undefined });
      }
    }

    const fresh = await this.userStore.get(userId);
    return this.createBoundAgent(userId, fresh);
  }

  async run(opts: SdkRunOptions): Promise<{
    result: SdkRunResult;
    cancel?: () => Promise<void>;
    dispose: () => Promise<void>;
  }> {
    const fullPrompt = await buildPrompt(opts.prompt, opts.mode, {
      skills: opts.pendingSkills,
      force: opts.state.force && opts.mode === "agent",
      prefix: opts.promptPrefix,
    });

    let state = opts.state;
    let agent: SDKAgent | undefined;
    let run: Run | undefined;

    try {
      await this.clearRunsForActiveSession(opts.userId, state);

      const force = opts.state.force && opts.mode === "agent";
      for (let attempt = 0; attempt < 3; attempt++) {
        agent = await this.openAgent(opts.userId, state);
        try {
          run = await this.sendToAgent(agent, fullPrompt, opts.mode, force);
          break;
        } catch (sendErr) {
          await agent[Symbol.asyncDispose]().catch(() => {});
          agent = undefined;
          if (isAgentMissingError(sendErr)) {
            state = await this.userStore.get(opts.userId);
            agent = await this.recoverMissingAgent(opts.userId, state);
            state = await this.userStore.get(opts.userId);
            run = await this.sendToAgent(agent, fullPrompt, opts.mode, force);
            break;
          }
          if (!isActiveRunConflict(sendErr) || attempt === 2) throw sendErr;

          const session = state.activeSessionId
            ? await this.sessionStore.getById(opts.userId, state.activeSessionId)
            : undefined;
          if (session) {
            await this.safeClearRunsForAgent(
              session.agentId,
              state.workspacePath,
            );
          }
          if (attempt === 0) continue;

          state = await this.rotateSession(opts.userId, state);
        }
      }

      if (!agent || !run) {
        throw new Error("에이전트 실행을 시작하지 못했습니다.");
      }

      let accumulated = "";
      for await (const event of run.stream()) {
        if (event.type === "assistant") {
          for (const block of event.message.content) {
            if (block.type === "text") {
              accumulated += block.text;
              opts.onAssistantText?.(accumulated);
            }
          }
        }
      }

      const waited = await run.wait();
      const text =
        accumulated ||
        (waited.status === "finished" ? "(응답 없음)" : `실행 종료: ${waited.status}`);

      const cancel = run.supports("cancel")
        ? async () => {
            await run?.cancel();
          }
        : undefined;

      const dispose = async () => {
        if (agent) await agent[Symbol.asyncDispose]().catch(() => {});
      };

      return {
        result: {
          text,
          runId: waited.id,
          agentId: agent.agentId,
          status: waited.status,
        },
        cancel,
        dispose,
      };
    } catch (err) {
      if (agent) await agent[Symbol.asyncDispose]().catch(() => {});
      throw err;
    }
  }

  async listModels(): Promise<string[]> {
    const models = await Cursor.models.list({
      apiKey: this.env.CURSOR_API_KEY,
    });
    return models.map((m) => m.id);
  }

  async syncSessionsFromSdk(userId: number, workspacePath: string): Promise<number> {
    const list = await Agent.list({
      runtime: "local",
      cwd: workspacePath,
      limit: 20,
    });
    let imported = 0;
    for (const item of list.items) {
      const before = await this.sessionStore.listForUser(userId, workspacePath);
      if (!before.some((s) => s.agentId === item.agentId)) {
        await this.sessionStore.importAgent(userId, item.agentId, workspacePath);
        imported++;
      }
    }
    return imported;
  }
}
