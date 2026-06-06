import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import {
  modePickerKeyboard,
  modelsKeyboard,
  sessionsKeyboard,
  skillsKeyboard,
  workspacesKeyboard,
  formatSessionLine,
} from "../keyboards/inline.js";
import {
  commitSkillPicker,
  discardSkillPickerPatch,
  formatSkillsPickerText,
  getPickerSelection,
  openSkillPicker,
  pickerWizardPatch,
  skillDescriptionToast,
} from "./skills-ui.js";
import { discoverSkills } from "../services/skill-discovery.js";
import { loadWorkspacesConfig } from "../store/defaults.js";
import { formatWorkspacesPickerText } from "../utils/workspace-label.js";
import { defaultParamsForModelChange } from "../services/model-selection.js";
import { formatParamsLine, paramsForModel } from "../config/model-env.js";
import {
  formatModelStatus,
  modelParamsKeyboard,
} from "./model-params-ui.js";

export function registerCallbacks(bot: Bot<BotContext>): void {
  bot.callbackQuery(/^plan:(exec|cancel)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from!.id;
    const state = await ctx.app.userStore.get(userId);
    const pending = state.pendingPlanApproval;
    if (!pending) {
      await ctx.reply("대기 중인 Plan이 없습니다.");
      return;
    }

    if (ctx.match![1] === "cancel") {
      await ctx.app.userStore.update(userId, { pendingPlanApproval: undefined });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      await ctx.reply("Plan 실행을 취소했습니다.");
      return;
    }

    await ctx.app.userStore.update(userId, { pendingPlanApproval: undefined });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });

    await ctx.app.runner.executeApprovedPlan(
      userId,
      ctx.chat!.id,
      ctx.api,
      pending.originalPrompt,
      pending.planSummary,
    );
  });

  bot.callbackQuery(/^set:(mode|workspace|model|modelparams|skills|force|sessions|close)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const action = ctx.match![1];
    const userId = ctx.from!.id;
    const state = await ctx.app.userStore.get(userId);

    if (action === "close") {
      await ctx.deleteMessage().catch(() => {});
      return;
    }
    if (action === "mode") {
      await ctx.editMessageText("기본 모드를 선택하세요:", {
        reply_markup: modePickerKeyboard(),
      });
      return;
    }
    if (action === "workspace") {
      const entries = await ctx.app.workspaceStore.listEntries();
      await ctx.editMessageText(
        formatWorkspacesPickerText(entries, state.workspacePath),
        { reply_markup: workspacesKeyboard(entries, state.workspacePath) },
      );
      return;
    }
    if (action === "model") {
      const models = await ctx.app.runner.listModels();
      await ctx.editMessageText("모델을 선택하세요:", {
        reply_markup: modelsKeyboard(models, state.modelId),
      });
      return;
    }
    if (action === "modelparams") {
      const cat = await ctx.app.modelCatalog.get(state.modelId);
      if (!cat?.parameters.length) {
        await ctx.reply(`${state.modelId} 에는 변경 가능한 옵션이 없습니다.`);
        return;
      }
      const text = formatModelStatus(state, ctx.app.modelConfig, cat);
      const active =
        state.modelParams.length && !ctx.app.modelConfig.paramsLock
          ? state.modelParams
          : paramsForModel(ctx.app.modelConfig, state.modelId);
      await ctx.editMessageText(text, {
        reply_markup: modelParamsKeyboard(
          state.modelId,
          cat,
          active,
          ctx.app.modelConfig.paramsLock,
        ),
      });
      return;
    }
    if (action === "skills") {
      const userId = ctx.from!.id;
      await openSkillPicker(ctx.app.userStore, userId);
      const config = await loadWorkspacesConfig();
      const profile = ctx.app.workspaceStore.getProfile(config, state.workspaceAlias);
      const skills = await discoverSkills(state.workspacePath, profile);
      await ctx.editMessageText(
        formatSkillsPickerText(skills, [], state.workspaceAlias),
        { reply_markup: skillsKeyboard(skills, []) },
      );
      return;
    }
    if (action === "force") {
      await ctx.app.userStore.update(userId, { force: !state.force });
      await ctx.reply(`Force: ${!state.force ? "ON" : "OFF"}`);
      return;
    }
    if (action === "sessions") {
      const sessions = await ctx.app.sessionStore.listForUser(
        userId,
        state.workspacePath,
      );
      const text =
        sessions.length === 0
          ? "세션이 없습니다. New Session을 만드세요."
          : sessions.map((s) => formatSessionLine(s, s.id === state.activeSessionId)).join("\n\n");
      await ctx.editMessageText(text, {
        reply_markup: sessionsKeyboard(sessions, state.activeSessionId),
      });
    }
  });

  bot.callbackQuery(/^mode:(ask|plan|agent|smart)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const mode = ctx.match![1] as "ask" | "plan" | "agent" | "smart";
    await ctx.app.userStore.update(ctx.from!.id, { defaultMode: mode });
    await ctx.reply(`기본 모드: ${mode}`);
  });

  bot.callbackQuery(/^ws:select:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const alias = ctx.match![1];
    const entry = await ctx.app.workspaceStore.getByAlias(alias);
    if (!entry) {
      await ctx.reply("알 수 없는 워크스페이스입니다.");
      return;
    }
    const { activateWorkspace } = await import("../services/workspace-switch.js");
    const msg = await activateWorkspace(
      ctx.app.userStore,
      ctx.app.workspaceStore,
      ctx.from!.id,
      entry,
    );
    await ctx.reply(msg);
  });

  bot.callbackQuery("ws:add", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.app.userStore.update(ctx.from!.id, {
      wizard: { kind: "workspace_add" },
    });
    await ctx.reply(
      "워크스페이스 **절대 경로**를 붙여넣으세요.\n예: C:\\project\\moodeng\n\n별칭은 경로의 마지막 이름으로 자동 저장됩니다.\n(짧은 이름만 내면 별칭→경로 2단계로 등록)",
    );
  });

  bot.callbackQuery("ws:default", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("기본 워크스페이스로 지정할 **이미 등록된** 별칭을 보내세요:");
    await ctx.app.userStore.update(ctx.from!.id, {
      wizard: { kind: "workspace_add_alias", data: { setDefaultOnly: "1" } },
    });
  });

  bot.callbackQuery("ws:close", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
  });

  async function refreshSkillsPicker(ctx: BotContext) {
    const userId = ctx.from!.id;
    const state = await ctx.app.userStore.get(userId);
    const selected = getPickerSelection(state);
    const config = await loadWorkspacesConfig();
    const profile = ctx.app.workspaceStore.getProfile(config, state.workspaceAlias);
    const skills = await discoverSkills(state.workspacePath, profile);
    const text = formatSkillsPickerText(skills, selected, state.workspaceAlias);
    const markup = skillsKeyboard(skills, selected);
    await ctx.editMessageText(text, { reply_markup: markup });
  }

  bot.callbackQuery(/^skill:toggle:(.+)$/, async (ctx) => {
    const name = ctx.match![1];
    const userId = ctx.from!.id;
    const state = await ctx.app.userStore.get(userId);
    const config = await loadWorkspacesConfig();
    const profile = ctx.app.workspaceStore.getProfile(config, state.workspaceAlias);
    const skills = await discoverSkills(state.workspacePath, profile);
    const skill = skills.find((s) => s.name === name);
    await ctx.answerCallbackQuery({
      text: skill ? skillDescriptionToast(skill) : name,
      show_alert: false,
    });
    const pending = new Set(getPickerSelection(state));
    if (pending.has(name)) pending.delete(name);
    else pending.add(name);
    const selected = [...pending];
    await ctx.app.userStore.update(userId, pickerWizardPatch(selected));
    await refreshSkillsPicker(ctx);
  });

  bot.callbackQuery("skill:clear", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "선택 해제" });
    await ctx.app.userStore.update(ctx.from!.id, pickerWizardPatch([]));
    await refreshSkillsPicker(ctx);
  });

  bot.callbackQuery("skill:apply", async (ctx) => {
    const userId = ctx.from!.id;
    const selected = await commitSkillPicker(ctx.app.userStore, userId);
    await ctx.answerCallbackQuery({ text: "적용됨" });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    if (selected.length > 0) {
      await ctx.reply(
        `다음 질문 1회에 적용: ${selected.join(", ")}\n질문을 보내세요.`,
      );
    } else {
      await ctx.reply("선택된 스킬이 없습니다. /skills 에서 다시 고르세요.");
    }
  });

  bot.callbackQuery("skill:refresh", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "새로고침" });
    await refreshSkillsPicker(ctx);
  });

  bot.callbackQuery("skill:src:both", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.app.userStore.update(ctx.from!.id, {
      skillSettingSources: ["project", "user"],
    });
    await ctx.reply("스킬 로딩: project + user");
  });

  bot.callbackQuery("skill:close", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.app.userStore.update(ctx.from!.id, discardSkillPickerPatch());
    await ctx.deleteMessage().catch(() => {});
  });

  bot.callbackQuery(/^model:pick:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const modelId = ctx.match![1];
    const params = defaultParamsForModelChange(ctx.app.modelConfig, modelId);
    await ctx.app.userStore.update(ctx.from!.id, { modelId, modelParams: params });
    const line = formatParamsLine(
      params.length ? params : paramsForModel(ctx.app.modelConfig, modelId),
    );
    await ctx.reply(`모델: ${modelId}\n옵션: ${line}`);
  });

  bot.callbackQuery("mp:noop", async (ctx) => {
    await ctx.answerCallbackQuery({ text: ".env 고정" });
  });

  bot.callbackQuery("mp:close", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
  });

  bot.callbackQuery(/^mp:reset:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const modelId = ctx.match![1];
    const params = paramsForModel(ctx.app.modelConfig, modelId);
    await ctx.app.userStore.update(ctx.from!.id, {
      modelId,
      modelParams: params.map((p) => ({ ...p })),
    });
    await ctx.reply(`↩ .env 기본 옵션:\n${formatParamsLine(params)}`);
  });

  bot.callbackQuery(/^mp:set:(.+)\|(.+)\|(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.app.modelConfig.paramsLock) {
      await ctx.reply("MODEL_PARAMS_LOCK=true — .env만 적용됩니다.");
      return;
    }
    const [, modelId, paramId, value] = ctx.match!;
    const userId = ctx.from!.id;
    const state = await ctx.app.userStore.get(userId);
    const base =
      state.modelId === modelId && state.modelParams.length
        ? [...state.modelParams]
        : [...paramsForModel(ctx.app.modelConfig, modelId)];
    const idx = base.findIndex((p) => p.id === paramId);
    if (idx >= 0) base[idx] = { id: paramId, value };
    else base.push({ id: paramId, value });
    await ctx.app.userStore.update(userId, { modelId, modelParams: base });
    const cat = await ctx.app.modelCatalog.get(modelId);
    if (cat && ctx.callbackQuery?.message) {
      await ctx.editMessageText(formatModelStatus(
        { ...state, modelId, modelParams: base },
        ctx.app.modelConfig,
        cat,
      ), {
        reply_markup: modelParamsKeyboard(modelId, cat, base, false),
      });
    } else {
      await ctx.reply(`옵션: ${paramId}=${value}`);
    }
  });

  bot.callbackQuery(/^model:page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const page = Number(ctx.match![1]);
    const state = await ctx.app.userStore.get(ctx.from!.id);
    const models = await ctx.app.runner.listModels();
    await ctx.editMessageReplyMarkup({
      reply_markup: modelsKeyboard(models, state.modelId, page),
    });
  });

  bot.callbackQuery("model:close", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
  });

  bot.callbackQuery("sess:new", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from!.id;
    try {
      const label = await ctx.app.runner.createFreshSession(userId);
      await ctx.reply(`✅ 새 세션: ${label}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`❌ 새 세션 실패:\n${msg.slice(0, 3500)}`);
    }
  });

  bot.callbackQuery(/^sess:select:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const sessionId = ctx.match![1];
    await ctx.app.userStore.update(ctx.from!.id, { activeSessionId: sessionId });
    const s = await ctx.app.sessionStore.getById(ctx.from!.id, sessionId);
    await ctx.reply(`활성 세션: ${s?.label ?? sessionId}`);
  });

  bot.callbackQuery("sess:sync", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from!.id;
    const state = await ctx.app.userStore.get(userId);
    const n = await ctx.app.runner.syncSessionsFromSdk(
      userId,
      state.workspacePath,
    );
    await ctx.reply(`동기화 완료: ${n}개 가져옴`);
  });

  bot.callbackQuery("sess:close", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
  });

  bot.callbackQuery(/^sess:page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const page = Number(ctx.match![1]);
    const userId = ctx.from!.id;
    const state = await ctx.app.userStore.get(userId);
    const sessions = await ctx.app.sessionStore.listForUser(
      userId,
      state.workspacePath,
    );
    await ctx.editMessageReplyMarkup({
      reply_markup: sessionsKeyboard(sessions, state.activeSessionId, page),
    });
  });
}
