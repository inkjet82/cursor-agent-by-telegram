import type { DiscoveredSkill, UserState } from "../types.js";
import type { UserStateStore } from "../store/user-state.js";

const DESC_MAX = 200;

export function truncateSkillText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function getPickerSelection(state: UserState): string[] {
  if (state.wizard?.kind !== "skill_pick") return [];
  const raw = state.wizard.data?.selected;
  if (!raw) return [];
  return raw.split(",").filter(Boolean);
}

export function startSkillPickerPatch(): Partial<UserState> {
  return {
    wizard: { kind: "skill_pick", data: { selected: "" } },
  };
}

export function pickerWizardPatch(names: string[]): Partial<UserState> {
  return {
    wizard: {
      kind: "skill_pick",
      data: { selected: names.join(",") },
    },
  };
}

export function discardSkillPickerPatch(): Partial<UserState> {
  return { wizard: undefined };
}

export async function commitSkillPicker(
  userStore: UserStateStore,
  userId: number,
): Promise<string[]> {
  const state = await userStore.get(userId);
  if (state.wizard?.kind !== "skill_pick") {
    return state.pendingSkillNames;
  }
  const selected = getPickerSelection(state);
  await userStore.update(userId, {
    pendingSkillNames: selected,
    wizard: undefined,
  });
  return selected;
}

export async function openSkillPicker(
  userStore: UserStateStore,
  userId: number,
): Promise<UserState> {
  return userStore.update(userId, startSkillPickerPatch());
}

export function formatSkillsPickerText(
  skills: DiscoveredSkill[],
  selected: string[],
  workspaceAlias?: string,
): string {
  if (skills.length === 0) {
    return "스킬이 없습니다.\n.cursor/skills 또는 .agents/skills 를 확인하세요.";
  }

  const lines = [
    `📚 스킬 (${skills.length}개) · 다음 질문 1회`,
    workspaceAlias ? `워크스페이스: ${workspaceAlias}` : "",
    "",
    selected.length > 0
      ? `선택: ${selected.join(", ")}`
      : "선택: (없음)",
    "버튼으로 고른 뒤 질문을 보내거나 [적용]을 누르세요.",
    "탭 시 스킬 설명이 잠깐 표시됩니다.",
  ].filter((l, i) => i !== 1 || l);

  return lines.join("\n");
}

export function skillDescriptionToast(skill: DiscoveredSkill): string {
  if (!skill.description) return skill.name;
  return truncateSkillText(skill.description, DESC_MAX);
}
