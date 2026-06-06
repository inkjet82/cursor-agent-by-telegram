import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { InputFile } from "grammy";
import type { Context } from "grammy";
import type { BotContext } from "../context.js";
import { PROJECT_ROOT } from "../env.js";

const execFileAsync = promisify(execFile);
const MAX_FIX_ATTEMPTS = 2;
const LOG_PATH = path.join(PROJECT_ROOT, "data", "restart-last.log");
const PM2_RELOAD_SCRIPT = path.join(PROJECT_ROOT, "scripts", "pm2-reload.mjs");

function npmCmd(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function appendLog(text: string): Promise<void> {
  await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
  await fs.appendFile(
    LOG_PATH,
    `\n--- ${new Date().toISOString()} ---\n${text}\n`,
    "utf-8",
  );
}

async function runBuild(): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(npmCmd(), ["run", "build"], {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true, output: `${stdout}\n${stderr}`.trim() };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const output = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n");
    return { ok: false, output };
  }
}

async function schedulePm2Reload(): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [PM2_RELOAD_SCRIPT],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env },
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    return { ok: true, output: `${stdout}\n${stderr}`.trim() };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const output = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n");
    return { ok: false, output };
  }
}

function truncateForTelegram(text: string, max = 3500): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `…\n${t.slice(-max)}`;
}

/** PM2 재시작 전: 빌드 + 실패 시 봇 repo에서 Agent 자동 수정 */
export async function runRestartWithFix(
  ctx: Context & { app: BotContext["app"] },
): Promise<void> {
  const chatId = ctx.chat!.id;
  const userId = ctx.from!.id;
  const api = ctx.api;

  await fs.writeFile(
    LOG_PATH,
    `restart started ${new Date().toISOString()}\n`,
    "utf-8",
  );

  const status = await ctx.reply("빌드 중…");
  const statusId = status.message_id;

  let build = await runBuild();
  let fixAttempt = 0;

  while (!build.ok && fixAttempt < MAX_FIX_ATTEMPTS) {
    fixAttempt += 1;
    await appendLog(`build failed (attempt ${fixAttempt}):\n${build.output}`);
    await api.editMessageText(
      chatId,
      statusId,
      `빌드 실패. 자동 수정 시도 (${fixAttempt}/${MAX_FIX_ATTEMPTS})…`,
    );

    try {
      await ctx.app.runner.runAgentFix(userId, {
        compileErrors: build.output,
        workspacePath: PROJECT_ROOT,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await appendLog(`agent fix failed: ${msg}`);
      await api.editMessageText(
        chatId,
        statusId,
        `자동 수정 실패 (${fixAttempt}/${MAX_FIX_ATTEMPTS}):\n${truncateForTelegram(msg, 500)}`,
      );
      break;
    }

    build = await runBuild();
  }

  if (!build.ok) {
    await appendLog(`final build failed:\n${build.output}`);
    await api.editMessageText(
      chatId,
      statusId,
      `빌드 실패. 재시작하지 않습니다.\n\n${truncateForTelegram(build.output, 2800)}`,
    );
    try {
      await api.sendDocument(chatId, new InputFile(LOG_PATH), {
        caption: "restart-last.log",
      });
    } catch {
      /* ignore */
    }
    return;
  }

  await api.editMessageText(chatId, statusId, "빌드 성공. PM2 재시작 중…");
  const reload = await schedulePm2Reload();
  await appendLog(`build ok. pm2: ${reload.output}`);

  if (!reload.ok) {
    await api.editMessageText(
      chatId,
      statusId,
      `빌드는 성공했지만 PM2 재시작 스크립트 실패:\n${truncateForTelegram(reload.output, 1500)}`,
    );
    return;
  }

  await api.editMessageText(
    chatId,
    statusId,
    "빌드 완료. PM2 재시작을 예약했습니다.\n잠시 후 「봇이 재시작되었습니다」 알림이 옵니다.",
  );
}
