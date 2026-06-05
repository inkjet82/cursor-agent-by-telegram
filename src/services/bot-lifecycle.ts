import { spawn } from "node:child_process";
import type { Api } from "grammy";
import type { AppContext } from "../context.js";
import { getAllowedChatIds, PROJECT_ROOT } from "../env.js";

export function formatStartupMessage(
  modelId: string,
  sessionLabel?: string,
): string {
  const when = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  return [
    "✅ 봇이 재시작되었습니다.",
    `시각: ${when}`,
    `모델: ${modelId}`,
    `세션: ${sessionLabel ?? "(없음)"}`,
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
    const text = formatStartupMessage(state.modelId, sessionLabel);
    await api.sendMessage(chatId, text).catch((err) => {
      console.warn(`startup notify failed for ${chatId}:`, err);
    });
  }
}

/** 빌드 후 PM2 재시작 (현재 프로세스는 PM2가 교체함) */
export function schedulePm2Restart(): void {
  const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(cmd, ["run", "pm2:restart"], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
