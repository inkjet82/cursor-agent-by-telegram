import { config } from "dotenv";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(rootDir, "..");

config({ path: path.join(PROJECT_ROOT, ".env") });

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_ALLOWED_CHAT_IDS: z.string().optional(),
  CURSOR_API_KEY: z.string().min(1),
  DEFAULT_MODEL_ID: z.string().default("composer-2.5"),
  DEFAULT_MODE: z.enum(["ask", "plan", "agent", "smart"]).optional(),
  /** JSON: {"composer-2.5":[{"id":"fast","value":"false"}]} — overrides config/model-params.json */
  MODEL_DEFAULT_PARAMS: z.string().optional(),
  /** true = always use .env/config params; Telegram cannot change */
  MODEL_PARAMS_LOCK: z.string().optional(),
  /** false = keep manual params when switching models */
  MODEL_PARAMS_RESET_ON_MODEL_CHANGE: z.string().optional(),
  /** Browser WorkosCursorSessionToken (cursor.com cookies) for usage dashboard API */
  CURSOR_SESSION_TOKEN: z.string().optional(),
  /** Default https://api2.cursor.sh */
  CURSOR_USAGE_API_BASE: z.string().optional(),
  /** true = /agent skips plan approval step */
  SKIP_PLAN_APPROVAL: z.string().optional(),
  MAX_CONCURRENT_JOBS: z.coerce.number().default(1),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  return envSchema.parse(process.env);
}

export function envFlag(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes";
}

export function getAllowedChatIds(env: Env): Set<number> {
  const ids = new Set<number>();
  if (env.TELEGRAM_CHAT_ID) {
    ids.add(Number(env.TELEGRAM_CHAT_ID));
  }
  if (env.TELEGRAM_ALLOWED_CHAT_IDS) {
    for (const part of env.TELEGRAM_ALLOWED_CHAT_IDS.split(",")) {
      const n = Number(part.trim());
      if (!Number.isNaN(n)) ids.add(n);
    }
  }
  return ids;
}
