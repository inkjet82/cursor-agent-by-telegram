import { loadEnv } from "./env.js";
import { createContext } from "./context.js";
import { createBot } from "./bot.js";
import { notifyBotStarted } from "./services/bot-lifecycle.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await createContext(env);
  const bot = createBot(env, app);

  const shutdown = async () => {
    await bot.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  console.log("Cursor Telegram bot starting (long polling)…");
  await bot.init();
  await notifyBotStarted(bot.api, app);
  await bot.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
