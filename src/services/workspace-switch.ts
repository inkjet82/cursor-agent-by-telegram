import { discoverSkills } from "./skill-discovery.js";
import { loadWorkspacesConfig } from "../store/defaults.js";
import type { WorkspaceEntry } from "../types.js";
import type { UserStateStore } from "../store/user-state.js";
import type { WorkspaceStore } from "../store/workspace-store.js";

export async function activateWorkspace(
  userStore: UserStateStore,
  workspaceStore: WorkspaceStore,
  userId: number,
  entry: WorkspaceEntry,
): Promise<string> {
  const config = await loadWorkspacesConfig();
  const profile = workspaceStore.getProfile(config, entry.alias);
  const skills = await discoverSkills(entry.path, profile);
  const prev = await userStore.get(userId);

  await userStore.update(userId, {
    workspacePath: entry.path,
    workspaceAlias: entry.alias,
    pendingSkillNames: [],
  });

  const lines = [
    `워크스페이스: ${entry.alias}`,
    `실행 경로: ${entry.path}`,
    `스킬: ${skills.length}개 (이 폴더의 .cursor/skills · .agents/skills)`,
  ];
  if (skills.length > 0) {
    lines.push(skills.map((s) => `  · ${s.name}`).slice(0, 8).join("\n"));
    if (skills.length > 8) lines.push(`  … 외 ${skills.length - 8}개`);
  }
  if (prev.activeSessionId && prev.workspacePath !== entry.path) {
    lines.push("", "⚠️ 이전 세션은 다른 폴더용일 수 있습니다. /new 권장.");
  }
  return lines.join("\n");
}
