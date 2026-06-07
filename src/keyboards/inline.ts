import { InlineKeyboard } from "grammy";
import type { DiscoveredSkill, SessionRecord, WorkspaceEntry } from "../types.js";
import { shortId } from "../utils/paths.js";

export function planApprovalKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("실행", "plan:exec");
}

export function planDraftKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("계획 완료", "plan:finalize");
}

export function settingsMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("기본 모드", "set:mode")
    .text("워크스페이스", "set:workspace")
    .row()
    .text("모델", "set:model")
    .text("모델 옵션", "set:modelparams")
    .row()
    .text("스킬", "set:skills")
    .row()
    .text("Force", "set:force")
    .text("세션", "set:sessions")
    .row()
    .text("닫기", "set:close");
}

export function modePickerKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Ask", "mode:ask")
    .text("Plan", "mode:plan")
    .row()
    .text("Agent", "mode:agent")
    .text("Smart", "mode:smart");
}

export function workspacesKeyboard(
  entries: WorkspaceEntry[],
  activePath: string,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const e of entries.slice(0, 8)) {
    const mark = e.path === activePath ? "✓ " : "";
    const label = `${mark}${e.alias}`;
    kb.text(label, `ws:select:${e.alias}`).row();
  }
  kb.text("➕ 경로 추가", "ws:add").text("⭐ 기본 지정", "ws:default").row();
  kb.text("닫기", "ws:close");
  return kb;
}

export function sessionsKeyboard(
  sessions: SessionRecord[],
  activeId?: string,
  page = 0,
): InlineKeyboard {
  const perPage = 5;
  const slice = sessions.slice(page * perPage, (page + 1) * perPage);
  const kb = new InlineKeyboard();
  for (const s of slice) {
    const mark = s.id === activeId ? "✓ " : "";
    kb.text(`${mark}${s.label}`, `sess:select:${s.id}`).row();
  }
  kb.text("➕ New Session", "sess:new").row();
  if (page > 0) kb.text("◀ 이전", `sess:page:${page - 1}`);
  if ((page + 1) * perPage < sessions.length) {
    kb.text("다음 ▶", `sess:page:${page + 1}`);
  }
  kb.row().text("🔄 동기화", "sess:sync").text("닫기", "sess:close");
  return kb;
}

export function skillsKeyboard(
  skills: DiscoveredSkill[],
  selected: string[],
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name));
  for (const s of sorted) {
    const on = selected.includes(s.name);
    kb.text(`${on ? "☑" : "☐"} ${s.name}`, `skill:toggle:${s.name}`).row();
  }
  kb.text("초기화", "skill:clear").text("적용", "skill:apply").row();
  kb.text("🔄", "skill:refresh").text("프로젝트+PC", "skill:src:both").row();
  kb.text("닫기", "skill:close");
  return kb;
}

export function modelsKeyboard(models: string[], current: string, page = 0): InlineKeyboard {
  const perPage = 8;
  const slice = models.slice(page * perPage, (page + 1) * perPage);
  const kb = new InlineKeyboard();
  for (const id of slice) {
    const mark = id === current ? "✓ " : "";
    kb.text(`${mark}${id}`, `model:pick:${id}`).row();
  }
  if (page > 0) kb.text("◀", `model:page:${page - 1}`);
  if ((page + 1) * perPage < models.length) {
    kb.text("▶", `model:page:${page + 1}`);
  }
  kb.row().text("닫기", "model:close");
  return kb;
}

export function sessionDeleteConfirmKeyboard(sessionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("삭제 확인", `sess:delok:${sessionId}`)
    .text("취소", "sess:delno");
}

export function formatSessionLine(s: SessionRecord, active: boolean): string {
  const mark = active ? "✓" : "○";
  return `${mark} ${s.label}\n  ${shortId(s.agentId)} · ${s.lastPromptPreview ?? "(없음)"}`;
}
