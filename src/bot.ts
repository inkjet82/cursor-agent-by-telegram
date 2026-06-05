import { Bot } from "grammy";
import type { BotContext } from "./context.js";
import type { Env } from "./env.js";
import { authMiddleware } from "./middleware/auth.js";
import { registerCallbacks } from "./handlers/callbacks.js";
import { mainReplyKeyboard, REPLY_LABELS } from "./keyboards/reply.js";
import {
  settingsMenuKeyboard,
  sessionsKeyboard,
  skillsKeyboard,
  workspacesKeyboard,
  formatSessionLine,
} from "./keyboards/inline.js";
import { formatHelp, formatStatus } from "./handlers/status-text.js";
import {
  commitSkillPicker,
  formatSkillsPickerText,
  openSkillPicker,
} from "./handlers/skills-ui.js";
import { resolveModeForText } from "./services/mode-resolver.js";
import { discoverSkills, filterSkills } from "./services/skill-discovery.js";
import { loadWorkspacesConfig } from "./store/defaults.js";
import type { AgentMode } from "./types.js";
import {
  assertWorkspaceInRoots,
  resolveWorkspacePath,
  workspaceExists,
} from "./utils/paths.js";
import { commandArgs } from "./utils/command-args.js";
import { buildModelSelection } from "./services/model-selection.js";
import { activateWorkspace } from "./services/workspace-switch.js";
import {
  aliasFromPath,
  formatWorkspacesPickerText,
  looksLikeFolderPath,
} from "./utils/workspace-label.js";
import { schedulePm2Restart } from "./services/bot-lifecycle.js";

const BOT_COMMANDS = [
  { command: "start", description: "시작 및 키보드" },
  { command: "help", description: "도움말" },
  { command: "ask", description: "Ask 모드 질문" },
  { command: "plan", description: "Plan + 실행 버튼" },
  { command: "agent", description: "즉시 Agent" },
  { command: "skills", description: "스킬 목록" },
  { command: "sessions", description: "세션 목록" },
  { command: "new", description: "새 세션" },
  { command: "session", description: "세션 이름" },
  { command: "settings", description: "설정" },
  { command: "workspaces", description: "워크스페이스 선택" },
  { command: "workspace", description: "경로로 워크스페이스 지정" },
  { command: "status", description: "상태" },
  { command: "usage", description: "사용량 상세" },
  { command: "cancel", description: "취소" },
  { command: "approve", description: "Plan 승인 후 실행" },
  { command: "models", description: "모델 목록" },
  { command: "mode", description: "기본 모드" },
  { command: "restart", description: "빌드 후 PM2 재시작" },
];

export function createBot(env: Env, app: BotContext["app"]): Bot<BotContext> {
  const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);

  bot.use(async (ctx, next) => {
    ctx.app = app;
    await next();
  });
  bot.use(authMiddleware(env));

  registerCallbacks(bot);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Cursor 원격 봇입니다. 하단 버튼 또는 /help 를 사용하세요.",
      { reply_markup: mainReplyKeyboard() },
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(formatHelp());
  });

  bot.command("restart", async (ctx) => {
    await ctx.reply(
      "빌드 후 PM2로 재시작합니다.\n잠시 연결이 끊겼다가, 성공하면 「봇이 재시작되었습니다」 알림이 옵니다.",
    );
    schedulePm2Restart();
  });

  bot.command("settings", async (ctx) => {
    await ctx.reply("설정:", { reply_markup: settingsMenuKeyboard() });
  });

  bot.command("status", async (ctx) => {
    const userId = ctx.from!.id;
    const state = await app.userStore.get(userId);
    let sessionLabel: string | undefined;
    if (state.activeSessionId) {
      const s = await app.sessionStore.getById(userId, state.activeSessionId);
      sessionLabel = s?.label;
    }
    const usageLine = await app.usageService.getStatusLine();
    await ctx.reply(
      formatStatus(
        state,
        app.modelConfig,
        sessionLabel,
        app.jobQueue.isBusy(userId),
        usageLine,
      ),
    );
  });

  bot.command("usage", async (ctx) => {
    const force = commandArgs(ctx, "usage").toLowerCase() === "refresh";
    const text = await app.usageService.getFullMessage(force);
    await ctx.reply(text);
  });

  bot.command("cancel", async (ctx) => {
    const userId = ctx.from!.id;
    const job = app.jobQueue.getJob(userId);
    if (job?.cancel) {
      await job.cancel();
      app.jobQueue.clearJob(userId);
      await ctx.reply("취소 요청을 보냈습니다.");
      return;
    }
    const cleared = await app.runner.clearStaleActiveRun(userId);
    if (cleared) {
      await ctx.reply(
        "봇 메모리에는 작업이 없었지만, 에이전트에 남아 있던 실행을 정리했습니다. 다시 메시지를 보내세요.",
      );
      return;
    }
    await ctx.reply("취소할 작업이 없습니다.");
  });

  bot.command("workspaces", async (ctx) => {
    const state = await app.userStore.get(ctx.from!.id);
    const entries = await app.workspaceStore.listEntries();
    await ctx.reply(formatWorkspacesPickerText(entries, state.workspacePath), {
      reply_markup: workspacesKeyboard(entries, state.workspacePath),
    });
  });

  bot.command("sessions", async (ctx) => {
    const userId = ctx.from!.id;
    const state = await app.userStore.get(userId);
    const sessions = await app.sessionStore.listForUser(
      userId,
      state.workspacePath,
    );
    const text =
      sessions.length === 0
        ? "세션이 없습니다."
        : sessions
            .map((s) => formatSessionLine(s, s.id === state.activeSessionId))
            .join("\n\n");
    await ctx.reply(text, {
      reply_markup: sessionsKeyboard(sessions, state.activeSessionId),
    });
  });

  bot.command("new", async (ctx) => {
    const userId = ctx.from!.id;
    const label = await app.runner.createFreshSession(userId);
    await ctx.reply(`새 세션: ${label}`);
  });

  bot.command("session", async (ctx) => {
    const label = commandArgs(ctx, "session");
    const userId = ctx.from!.id;
    const state = await app.userStore.get(userId);
    if (!label) {
      await app.userStore.update(userId, {
        wizard: { kind: "session_rename" },
      });
      await ctx.reply("세션 표시 이름을 보내세요:");
      return;
    }
    if (state.activeSessionId) {
      await app.sessionStore.rename(userId, state.activeSessionId, label);
      await ctx.reply(`세션 이름: ${label}`);
    }
  });

  bot.command("mode", async (ctx) => {
    const arg = commandArgs(ctx, "mode") as AgentMode | "";
    if (!arg || !["ask", "plan", "agent", "smart"].includes(arg)) {
      await ctx.reply("사용: /mode ask|plan|agent|smart");
      return;
    }
    await app.userStore.update(ctx.from!.id, { defaultMode: arg as AgentMode });
    await ctx.reply(`기본 모드: ${arg}`);
  });

  async function replySkillsPicker(
    ctx: Pick<BotContext, "reply">,
    userId: number,
    query?: string,
  ) {
    const state = await openSkillPicker(app.userStore, userId);
    const config = await loadWorkspacesConfig();
    const profile = app.workspaceStore.getProfile(config, state.workspaceAlias);
    let skills = await discoverSkills(state.workspacePath, profile);
    if (query) skills = filterSkills(skills, query);
    await ctx.reply(
      skills.length
        ? formatSkillsPickerText(skills, [], state.workspaceAlias)
        : `스킬이 없습니다.\n${state.workspacePath}\n└ .cursor/skills 또는 .agents/skills 를 확인하세요.`,
      skills.length
        ? { reply_markup: skillsKeyboard(skills, []) }
        : undefined,
    );
  }

  bot.command("skills", async (ctx) => {
    const query = commandArgs(ctx, "skills");
    await replySkillsPicker(ctx, ctx.from!.id, query || undefined);
  });

  bot.command("workspace", async (ctx) => {
    const pathArg = commandArgs(ctx, "workspace");
    if (!pathArg) {
      await ctx.reply("사용: /workspace C:\\project\\moodeng\n또는 /workspaces");
      return;
    }
    const resolved = resolveWorkspacePath(pathArg);
    if (!workspaceExists(resolved)) {
      await ctx.reply("워크스페이스 경로를 찾을 수 없습니다.");
      return;
    }
    try {
      const config = await loadWorkspacesConfig();
      assertWorkspaceInRoots(resolved, config.roots);
    } catch (e) {
      await ctx.reply(e instanceof Error ? e.message : String(e));
      return;
    }
    const userId = ctx.from!.id;
    const alias = aliasFromPath(resolved);
    await app.workspaceStore.addUserEntry(alias, resolved, false);
    const entry = await app.workspaceStore.getByAlias(alias);
    const msg = await activateWorkspace(
      app.userStore,
      app.workspaceStore,
      userId,
      entry!,
    );
    await ctx.reply(msg);
  });

  async function runUserPrompt(
    ctx: { from?: { id: number }; chat?: { id: number }; api: Bot<BotContext>["api"] },
    text: string,
    explicit?: Exclude<AgentMode, "smart">,
    directAgent = false,
  ) {
    const userId = ctx.from!.id;
    await commitSkillPicker(app.userStore, userId);
    const state = await app.userStore.get(userId);
    const resolved = resolveModeForText(text, state.defaultMode, explicit);
    const attachPlan = resolved === "plan";
    await app.runner.execute({
      userId,
      chatId: ctx.chat!.id,
      prompt: text,
      mode: resolved,
      api: ctx.api,
      attachPlanButtons: attachPlan,
      directAgent: resolved === "agent" ? directAgent : undefined,
    });
  }

  bot.command("ask", async (ctx) => {
    const text = commandArgs(ctx, "ask");
    if (!text) {
      await app.userStore.update(ctx.from!.id, { awaitingPromptMode: "ask" });
      await ctx.reply("Ask 질문을 보내세요:");
      return;
    }
    await runUserPrompt(ctx, text, "ask");
  });

  bot.command("plan", async (ctx) => {
    const text = commandArgs(ctx, "plan");
    if (!text) {
      await app.userStore.update(ctx.from!.id, { awaitingPromptMode: "plan" });
      await ctx.reply("Plan 요청을 보내세요:");
      return;
    }
    await runUserPrompt(ctx, text, "plan");
  });

  bot.command("approve", async (ctx) => {
    const userId = ctx.from!.id;
    const state = await app.userStore.get(userId);
    const pending = state.pendingPlanApproval;
    if (!pending) {
      await ctx.reply("대기 중인 Plan이 없습니다. /plan 으로 계획을 만드세요.");
      return;
    }
    await app.userStore.update(userId, { pendingPlanApproval: undefined });
    await app.runner.executeApprovedPlan(
      userId,
      ctx.chat!.id,
      ctx.api,
      pending.originalPrompt,
      pending.planSummary,
    );
  });

  bot.command("models", async (ctx) => {
    const text = await app.runner.listModelsText();
    const chunks = text.length > 4000 ? [text.slice(0, 4000), text.slice(4000)] : [text];
    for (const chunk of chunks) {
      await ctx.reply(chunk || "(모델 없음)");
    }
  });

  bot.command("agent", async (ctx) => {
    let text = commandArgs(ctx, "agent");
    let directAgent = false;
    if (text.startsWith("!")) {
      directAgent = true;
      text = text.slice(1).trim();
    } else if (text.startsWith("--force")) {
      directAgent = true;
      text = text.replace(/^--force\s*/, "").trim();
    }
    if (!text) {
      await app.userStore.update(ctx.from!.id, { awaitingPromptMode: "agent" });
      await ctx.reply(
        "Agent 요청을 보내세요.\n기본: Plan 확인 후 실행 · 즉시: /agent! 또는 /agent --force",
      );
      return;
    }
    await app.runner.execute({
      userId: ctx.from!.id,
      chatId: ctx.chat!.id,
      prompt: text,
      mode: "agent",
      api: ctx.api,
      directAgent,
    });
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;

    if (text === "폴더") {
      const st = await app.userStore.get(userId);
      const entries = await app.workspaceStore.listEntries();
      await ctx.reply(formatWorkspacesPickerText(entries, st.workspacePath), {
        reply_markup: workspacesKeyboard(entries, st.workspacePath),
      });
      await ctx.reply(
        "「폴더」는 「워크스페이스」로 바뀌었습니다. 하단 메뉴를 갱신합니다.",
        { reply_markup: mainReplyKeyboard() },
      );
      return;
    }

    if (REPLY_LABELS.has(text)) {
      switch (text) {
        case "Ask":
          await app.userStore.update(userId, { awaitingPromptMode: "ask" });
          await ctx.reply("Ask 질문을 입력하세요:");
          return;
        case "Plan":
          await app.userStore.update(userId, { awaitingPromptMode: "plan" });
          await ctx.reply("Plan 요청을 입력하세요:");
          return;
        case "Agent":
          await app.userStore.update(userId, { awaitingPromptMode: "agent" });
          await ctx.reply("Agent 요청을 입력하세요:");
          return;
        case "세션": {
          const st = await app.userStore.get(userId);
          const sessions = await app.sessionStore.listForUser(
            userId,
            st.workspacePath,
          );
          await ctx.reply(
            sessions.length
              ? sessions
                  .map((s) => formatSessionLine(s, s.id === st.activeSessionId))
                  .join("\n\n")
              : "세션이 없습니다.",
            {
              reply_markup: sessionsKeyboard(sessions, st.activeSessionId),
            },
          );
          return;
        }
        case "워크스페이스": {
          const st = await app.userStore.get(userId);
          const entries = await app.workspaceStore.listEntries();
          await ctx.reply(formatWorkspacesPickerText(entries, st.workspacePath), {
            reply_markup: workspacesKeyboard(entries, st.workspacePath),
          });
          return;
        }
        case "스킬":
          await replySkillsPicker(ctx, userId);
          return;
        case "설정":
          await ctx.reply("설정:", { reply_markup: settingsMenuKeyboard() });
          return;
        case "상태": {
          const st = await app.userStore.get(userId);
          let sessionLabel: string | undefined;
          if (st.activeSessionId) {
            const s = await app.sessionStore.getById(userId, st.activeSessionId);
            sessionLabel = s?.label;
          }
          const usageLine = await app.usageService.getStatusLine();
          await ctx.reply(
            formatStatus(
              st,
              app.modelConfig,
              sessionLabel,
              app.jobQueue.isBusy(userId),
              usageLine,
            ),
          );
          return;
        }
        case "취소": {
          const job = app.jobQueue.getJob(userId);
          if (job?.cancel) {
            await job.cancel();
            app.jobQueue.clearJob(userId);
            await ctx.reply("취소 요청을 보냈습니다.");
            return;
          }
          const cleared = await app.runner.clearStaleActiveRun(userId);
          if (cleared) {
            await ctx.reply(
              "봇 메모리에는 작업이 없었지만, 에이전트에 남아 있던 실행을 정리했습니다. 다시 메시지를 보내세요.",
            );
            return;
          }
          await ctx.reply("취소할 작업이 없습니다.");
          return;
        }
        case "도움말":
          await ctx.reply(formatHelp());
          return;
      }
    }

    let state = await app.userStore.get(userId);

    if (state.wizard) {
      const w = state.wizard;
      if (w.kind === "workspace_add") {
        if (looksLikeFolderPath(text)) {
          try {
            const resolved = resolveWorkspacePath(text.trim());
            if (!workspaceExists(resolved)) {
              await ctx.reply("워크스페이스 경로를 찾을 수 없습니다.");
              return;
            }
            const wsConfig = await loadWorkspacesConfig();
            assertWorkspaceInRoots(resolved, wsConfig.roots);
            const alias = aliasFromPath(resolved);
            await app.workspaceStore.addUserEntry(alias, resolved, false);
            const entry = await app.workspaceStore.getByAlias(alias);
            await app.userStore.update(userId, { wizard: undefined });
            const msg = await activateWorkspace(
              app.userStore,
              app.workspaceStore,
              userId,
              entry!,
            );
            await ctx.reply(msg);
          } catch (e) {
            await ctx.reply(e instanceof Error ? e.message : String(e));
          }
          return;
        }
        const alias = text.replace(/\s+/g, "-").slice(0, 32);
        await app.userStore.update(userId, {
          wizard: { kind: "workspace_add_path", data: { alias } },
        });
        await ctx.reply(`경로를 붙여넣으세요 (별칭: ${alias}):`);
        return;
      }
      if (w.kind === "workspace_add_alias" && w.data?.setDefaultOnly === "1") {
        const entry = await app.workspaceStore.getByAlias(
          text.replace(/\s+/g, "-").slice(0, 32),
        );
        if (!entry) {
          await ctx.reply("등록된 별칭이 없습니다. /workspaces 에서 확인하세요.");
          return;
        }
        if (entry.source === "user") {
          await app.workspaceStore.setDefaultAlias(entry.alias);
        }
        await app.userStore.update(userId, { wizard: undefined });
        const msg = await activateWorkspace(
          app.userStore,
          app.workspaceStore,
          userId,
          entry,
        );
        await ctx.reply(`기본 워크스페이스: ${entry.alias}\n\n${msg}`);
        return;
      }
      if (w.kind === "workspace_add_alias" && !w.data?.alias) {
        const alias = text.replace(/\s+/g, "-").slice(0, 32);
        await app.userStore.update(userId, {
          wizard: { kind: "workspace_add_path", data: { alias } },
        });
        await ctx.reply(`경로를 한 번 붙여넣으세요 (별칭: ${alias}):`);
        return;
      }
      if (w.kind === "workspace_add_path" && w.data?.alias) {
        try {
          const asDefault = state.wizard?.data?.setDefault === "1";
          await app.workspaceStore.addUserEntry(
            w.data.alias,
            text,
            asDefault,
          );
          const entry = await app.workspaceStore.getByAlias(w.data.alias);
          await app.userStore.update(userId, { wizard: undefined });
          const msg = await activateWorkspace(
            app.userStore,
            app.workspaceStore,
            userId,
            entry!,
          );
          await ctx.reply(msg);
        } catch (e) {
          await ctx.reply(e instanceof Error ? e.message : String(e));
        }
        return;
      }
      if (w.kind === "session_rename" && state.activeSessionId) {
        await app.sessionStore.rename(userId, state.activeSessionId, text);
        await app.userStore.update(userId, { wizard: undefined });
        await ctx.reply(`세션 이름: ${text}`);
        return;
      }
    }

    if (state.awaitingPromptMode) {
      const mode = state.awaitingPromptMode;
      await app.userStore.update(userId, { awaitingPromptMode: undefined });
      await runUserPrompt(ctx, text, mode);
      return;
    }

    await runUserPrompt(ctx, text);
  });

  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  bot.api.setMyCommands(BOT_COMMANDS).catch(console.error);

  return bot;
}
