import type { Context } from "grammy";

export function commandArgs(ctx: Context, command: string): string {
  const text = ctx.message?.text ?? "";
  const re = new RegExp(`^/${command}(?:@\\w+)?\\s*([\\s\\S]*)`, "i");
  const m = text.match(re);
  return m?.[1]?.trim() ?? "";
}
