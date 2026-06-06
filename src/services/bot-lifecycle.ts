import type { Api } from "grammy";
import type { AppContext } from "../context.js";
import { getAllowedChatIds } from "../env.js";

export function formatStartupMessage(
  modelId: string,
  opts?: {
    sessionLabel?: string;
    workspaceAlias?: string;
    workspacePath?: string;
  },
): string {
  const when = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  return [
    "✅ 봇이 재시작되었습니다.",
    `시각: ${when}`,
    `워크스페이스: ${opts?.workspaceAlias ?? "(미등록)"}`,
    `실행 경로: ${opts?.workspacePath ?? "(없음)"}`,
    `모델: ${modelId}`,
    `세션: ${opts?.sessionLabel ?? "(없음)"}`,
  ].join("\n");
}

/** 허용된 채팅(개인 채팅: chatId = userId)마다 기동 알림 */
export async function notifyBotStarted(
  api: Api,
  app: AppContext,
): Promise<void> {
  const chatIds = getAllowedChatIds(app.env);
  if (chatIds.size === 0) return;

  for (const chatId of chatIds) {
    const userId = chatId;
    const state = await app.userStore.get(userId);
    let sessionLabel: string | undefined;
    if (state.activeSessionId) {
      const session = await app.sessionStore.getById(
        userId,
        state.activeSessionId,
      );
      sessionLabel = session?.label;
    }
    const sessionWarn = await app.runner.validateActiveSession(userId);
    const lines = [
      formatStartupMessage(state.modelId, {
        sessionLabel,
        workspaceAlias: state.workspaceAlias,
        workspacePath: state.workspacePath,
      }),
      ...(sessionWarn ? [sessionWarn] : []),
    ];
    await api.sendMessage(chatId, lines.join("\n")).catch((err) => {
      console.warn(`startup notify failed for ${chatId}:`, err);
    });
  }
}

