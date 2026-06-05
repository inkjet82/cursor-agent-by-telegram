import { Keyboard } from "grammy";

export function mainReplyKeyboard(): Keyboard {
  return new Keyboard()
    .text("Ask")
    .text("Plan")
    .text("Agent")
    .row()
    .text("세션")
    .text("워크스페이스")
    .text("스킬")
    .row()
    .text("설정")
    .text("상태")
    .text("취소")
    .row()
    .text("도움말")
    .resized();
}

export const REPLY_LABELS = new Set([
  "Ask",
  "Plan",
  "Agent",
  "세션",
  "워크스페이스",
  "스킬",
  "설정",
  "상태",
  "취소",
  "도움말",
]);
