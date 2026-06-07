import { AgentBusyError, CursorAgentError } from "@cursor/sdk";
import type { Env } from "../env.js";
import { envFlag } from "../env.js";
import type { AgentMode, DiscoveredSkill, UserState } from "../types.js";
import { SessionStore } from "../store/session-store.js";
import { UserStateStore } from "../store/user-state.js";
import { discoverSkills } from "./skill-discovery.js";
import { loadWorkspacesConfig } from "../store/defaults.js";
import { WorkspaceStore } from "../store/workspace-store.js";
import type { Api } from "grammy";
import { splitMessage } from "./telegram-format.js";
import type { JobQueue } from "./job-queue.js";
import type { ModelCatalog } from "./model-catalog.js";
import type { ModelEnvConfig } from "../config/model-env.js";
import { CursorSdkRunner } from "./cursor-sdk.js";
import {
  fileDeliveryAgentHint,
  resolveFilesFromRequest,
  tryDeliverFilesForTurn,
  wantsFileDelivery,
} from "./telegram-file-delivery.js";

export interface RunOptions {
  userId: number;
  chatId: number;
  prompt: string;
  mode: Exclude<AgentMode, "smart">;
  api: Api;
  statusMessageId?: number;
  /** @deprecated use storePlanDraft behavior for plan mode */
  attachPlanButtons?: boolean;
  skipPlanStore?: boolean;
  /** Skip plan-first gate for /agent */
  directAgent?: boolean;
  /** Internal: agent→plan redirect already happened */
  skipPlanFirst?: boolean;
  /** Plan revision — keep originalPrompt from existing draft */
  planRevision?: boolean;
}

const PLAN_DRAFT_FOOTER =
  "\n\n📝 Plan 초안입니다. 수정은 계속 말씀해 주세요.\n완료: /done 또는 [계획 완료] 버튼";

export class CursorRunner {
  private sdk: CursorSdkRunner;

  constructor(
    private env: Env,
    modelConfig: ModelEnvConfig,
    modelCatalog: ModelCatalog,
    private userStore: UserStateStore,
    private sessionStore: SessionStore,
    private workspaceStore: WorkspaceStore,
    private jobQueue: JobQueue,
  ) {
    this.sdk = new CursorSdkRunner(
      env,
      modelConfig,
      modelCatalog,
      userStore,
      sessionStore,
    );
  }

  private skipPlanApproval(): boolean {
    return envFlag(this.env.SKIP_PLAN_APPROVAL);
  }

  private async getPendingSkills(state: UserState): Promise<DiscoveredSkill[]> {
    if (!state.pendingSkillNames.length) return [];
    const config = await loadWorkspacesConfig();
    const profile = this.workspaceStore.getProfile(
      config,
      state.workspaceAlias,
    );
    const all = await discoverSkills(state.workspacePath, profile);
    const byName = new Map(all.map((s) => [s.name, s]));
    return state.pendingSkillNames
      .map((n) => byName.get(n))
      .filter((s): s is DiscoveredSkill => s !== undefined);
  }

  async clearStaleActiveRun(userId: number): Promise<boolean> {
    const state = await this.userStore.get(userId);
    return this.sdk.clearStaleActiveRun(userId, state.workspacePath);
  }

  async streamToTelegram(
    api: Api,
    chatId: number,
    messageId: number,
    text: string,
  ): Promise<void> {
    const chunks = splitMessage(text);
    const body = chunks[0] ?? "…";
    try {
      await api.editMessageText(chatId, messageId, body, {
        parse_mode: "HTML",
      });
    } catch {
      await api.editMessageText(chatId, messageId, body).catch(() => {});
    }
    for (let i = 1; i < chunks.length; i++) {
      await api.sendMessage(chatId, chunks[i]!);
    }
  }

  async executeApprovedPlan(
    userId: number,
    chatId: number,
    api: Api,
    originalPrompt: string,
    planSummary: string,
  ): Promise<void> {
    const execPrompt = `Implement the following plan for the original request.

Original request:
${originalPrompt}

Approved plan:
${planSummary}`;

    await this.execute({
      userId,
      chatId,
      prompt: execPrompt,
      mode: "agent",
      api,
      directAgent: true,
      skipPlanFirst: true,
    });
  }

  async finalizePlanDraft(
    userId: number,
    chatId: number,
    api: Api,
  ): Promise<boolean> {
    const state = await this.userStore.get(userId);
    const draft = state.planDraft;
    if (!draft) return false;

    const session = state.activeSessionId
      ? await this.sessionStore.getById(userId, state.activeSessionId)
      : undefined;

    const summary = draft.summary.slice(0, 3500);
    const msg = await api.sendMessage(chatId, `✅ 계획 완료\n\n${summary}`, {
      reply_markup: (await import("../keyboards/inline.js")).planApprovalKeyboard(),
    });

    await this.userStore.update(userId, {
      planDraft: undefined,
      pendingPlanApproval: {
        sessionId: session?.id ?? "sdk",
        originalPrompt: draft.originalPrompt,
        planSummary: draft.summary,
        planMessageId: msg.message_id,
      },
    });
    return true;
  }

  async execute(opts: RunOptions): Promise<void> {
    const { userId, chatId, prompt, mode, api } = opts;

    if (this.jobQueue.isBusy(userId)) {
      await api.sendMessage(
        chatId,
        "이미 작업이 진행 중입니다. /cancel 후 다시 시도하세요.",
      );
      return;
    }

    if (
      mode === "agent" &&
      !opts.directAgent &&
      !this.skipPlanApproval() &&
      !opts.skipPlanFirst
    ) {
      await this.execute({
        ...opts,
        mode: "plan",
        skipPlanFirst: true,
      });
      return;
    }

    let state = await this.userStore.get(userId);
    const pendingSkills = await this.getPendingSkills(state);
    if (pendingSkills.length > 0) {
      await this.userStore.update(userId, { pendingSkillNames: [] });
      state = await this.userStore.get(userId);
    }

    if (wantsFileDelivery(prompt) && !opts.attachPlanButtons) {
      const files = await resolveFilesFromRequest(prompt, state.workspacePath);
      if (files.length > 0) {
        const statusMsg = await api.sendMessage(chatId, "📎 파일 전송 중…");
        const sent = await tryDeliverFilesForTurn(
          api,
          chatId,
          state.workspacePath,
          prompt,
        );
        const names = sent.map((f) => f.split(/[/\\]/).pop() ?? f).join("\n· ");
        await api.editMessageText(
          chatId,
          statusMsg.message_id,
          sent.length
            ? `📎 파일 ${sent.length}개를 보냈습니다.\n· ${names}`
            : "전송할 수 있는 파일을 찾지 못했습니다.",
        );
        return;
      }
    }

    const statusMsg = await api.sendMessage(chatId, "⏳ Cursor Agent 시작 중…");
    const statusId = opts.statusMessageId ?? statusMsg.message_id;
    await api.sendChatAction(chatId, "typing").catch(() => {});

    const promptPrefix = wantsFileDelivery(prompt)
      ? fileDeliveryAgentHint()
      : undefined;

    let lastEdit = 0;
    const onChunk = async (accumulated: string) => {
      const now = Date.now();
      if (accumulated && now - lastEdit > 1500) {
        lastEdit = now;
        await this.streamToTelegram(api, chatId, statusId, accumulated || "…");
        await api.sendChatAction(chatId, "typing").catch(() => {});
      }
    };

    try {
      const sdkRun = await this.sdk.run({
        userId,
        prompt,
        mode,
        state,
        pendingSkills,
        promptPrefix,
        onAssistantText: (t) => {
          void onChunk(t);
        },
      });

      this.jobQueue.setJob(userId, {
        executor: "sdk",
        runId: sdkRun.result.runId,
        agentId: sdkRun.result.agentId,
        cancel: sdkRun.cancel,
      });

      let finalText: string;
      let runStatus: string;
      try {
        finalText = sdkRun.result.text;
        runStatus = sdkRun.result.status;
      } finally {
        await sdkRun.dispose();
      }

      if (mode === "plan" && !opts.skipPlanStore) {
        const existingDraft = opts.planRevision
          ? (await this.userStore.get(userId)).planDraft
          : undefined;
        const originalPrompt = existingDraft?.originalPrompt ?? prompt;
        await this.userStore.update(userId, {
          planDraft: {
            originalPrompt,
            summary: finalText,
            updatedAt: new Date().toISOString(),
          },
          pendingPlanApproval: undefined,
        });
        const body = (finalText + PLAN_DRAFT_FOOTER).slice(0, 4000);
        const { planDraftKeyboard } = await import("../keyboards/inline.js");
        await api.editMessageText(chatId, statusId, body, {
          reply_markup: planDraftKeyboard(),
        });
      } else if (opts.attachPlanButtons && mode === "plan" && !opts.skipPlanStore) {
        const session = state.activeSessionId
          ? await this.sessionStore.getById(userId, state.activeSessionId)
          : undefined;
        await this.userStore.update(userId, {
          pendingPlanApproval: {
            sessionId: session?.id ?? "sdk",
            originalPrompt: prompt,
            planSummary: finalText,
            planMessageId: statusId,
          },
        });
        const { planApprovalKeyboard } = await import("../keyboards/inline.js");
        await api.editMessageText(chatId, statusId, finalText.slice(0, 4000), {
          reply_markup: planApprovalKeyboard(),
        });
      } else {
        await this.streamToTelegram(api, chatId, statusId, finalText);
      }

      const delivered = await tryDeliverFilesForTurn(
        api,
        chatId,
        state.workspacePath,
        prompt,
        finalText,
      );
      if (delivered.length > 0) {
        const names = delivered
          .map((f) => f.split(/[/\\]/).pop() ?? f)
          .join(", ");
        await api.sendMessage(chatId, `📎 첨부: ${names}`);
      }

      if (state.activeSessionId) {
        await this.sessionStore.touch(userId, state.activeSessionId, prompt);
      }

      if (runStatus === "error") {
        await api.sendMessage(chatId, "⚠️ 실행이 오류로 종료되었습니다.");
      }
    } catch (err) {
      const msg =
        err instanceof AgentBusyError
          ? "에이전트에 이전 실행이 남아 있습니다. 잠시 후 다시 보내거나 /cancel · /new 를 시도하세요."
          : err instanceof CursorAgentError &&
              /already has active run|active run/i.test(err.message)
            ? "이전 실행이 아직 종료되지 않았습니다. 자동 정리 후에도 실패했습니다. /cancel 또는 /new 후 다시 시도하세요."
            : err instanceof CursorAgentError &&
                /not found/i.test(err.message)
              ? "에이전트를 찾을 수 없습니다. /new 로 새 세션을 만든 뒤 다시 시도하세요. (Cursor IDE가 실행 중인지 확인)"
              : err instanceof CursorAgentError
              ? `시작 실패: ${err.message} (retryable=${err.isRetryable})`
              : err instanceof Error
              ? err.message
              : String(err);
      await api.editMessageText(chatId, statusId, `❌ ${msg}`).catch(() => {
        api.sendMessage(chatId, `❌ ${msg}`);
      });
    } finally {
      this.jobQueue.clearJob(userId);
    }
  }

  async listModels(): Promise<string[]> {
    return this.sdk.listModels();
  }

  async listModelsText(): Promise<string> {
    const ids = await this.sdk.listModels();
    return ids.join("\n");
  }

  async syncSessionsFromSdk(userId: number, workspacePath: string): Promise<number> {
    return this.sdk.syncSessionsFromSdk(userId, workspacePath);
  }

  async createFreshSession(userId: number): Promise<string> {
    const state = await this.userStore.get(userId);
    const record = await this.sdk.createFreshSession(userId, state);
    return record.label;
  }

  async validateActiveSession(userId: number): Promise<string | undefined> {
    return this.sdk.validateActiveSession(userId);
  }

  /** /restart 빌드 실패 시 봇 프로젝트에서 타입 오류만 수정 */
  async runAgentFix(
    userId: number,
    opts: { compileErrors: string; workspacePath: string },
  ): Promise<void> {
    const state = await this.userStore.get(userId);
    const fixState: UserState = {
      ...state,
      workspacePath: opts.workspacePath,
      force: true,
    };
    const prompt = `Fix TypeScript compile errors in this repository (Telegram bot). Only edit files under the current workspace. Minimal changes. Do not explain at length.

Compiler output:
${opts.compileErrors.slice(-12000)}`;

    const sdkRun = await this.sdk.run({
      userId,
      prompt,
      mode: "agent",
      state: fixState,
      pendingSkills: [],
    });
    try {
      if (sdkRun.result.status === "error") {
        throw new Error(sdkRun.result.text || "Agent fix run failed");
      }
    } finally {
      await sdkRun.dispose();
    }
  }
}
