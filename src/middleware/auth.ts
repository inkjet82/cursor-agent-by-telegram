import type { Middleware } from "grammy";
import { getAllowedChatIds, type Env } from "../env.js";
import type { BotContext } from "../context.js";

export function authMiddleware(env: Env): Middleware<BotContext> {
  const allowed = getAllowedChatIds(env);
  return async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined || !allowed.has(chatId)) {
      return;
    }
    await next();
  };
}
