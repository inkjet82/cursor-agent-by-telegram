import fs from "node:fs/promises";
import path from "node:path";
import type { DiscoveredSkill, WorkspaceProfile } from "../types.js";

const SKIP_DIR = "skills-cursor";

function parseFrontmatter(raw: string): Record<string, string> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

async function scanDir(skillsDir: string): Promise<DiscoveredSkill[]> {
  const results: DiscoveredSkill[] = [];
  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name === SKIP_DIR) continue;
    const skillMd = path.join(skillsDir, ent.name, "SKILL.md");
    try {
      const content = await fs.readFile(skillMd, "utf-8");
      const fm = parseFrontmatter(content);
      const name = fm.name ?? ent.name;
      results.push({
        name,
        description: fm.description ?? "",
        filePath: skillMd,
        disableModelInvocation:
          fm["disable-model-invocation"] === "true",
        paths: fm.paths,
      });
    } catch {
      // skip invalid skill folders
    }
  }
  return results;
}

export const DEFAULT_SKILL_ROOTS = [".cursor/skills", ".agents/skills"] as const;

export function skillSearchDirs(
  workspacePath: string,
  profile?: WorkspaceProfile,
): string[] {
  const relRoots = profile?.skillRoots ?? [...DEFAULT_SKILL_ROOTS];
  const dirs = new Set<string>();
  for (const rel of relRoots) {
    dirs.add(path.join(workspacePath, ...rel.split("/")));
  }
  for (const extra of profile?.extraSkillDirs ?? []) {
    dirs.add(path.isAbsolute(extra) ? extra : path.join(workspacePath, extra));
  }
  return [...dirs];
}

export async function discoverSkills(
  workspacePath: string,
  profile?: WorkspaceProfile,
): Promise<DiscoveredSkill[]> {
  const dirs = new Set(skillSearchDirs(workspacePath, profile));

  const byName = new Map<string, DiscoveredSkill>();
  for (const dir of dirs) {
    for (const skill of await scanDir(dir)) {
      if (!byName.has(skill.name)) byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function filterSkills(
  skills: DiscoveredSkill[],
  query?: string,
): DiscoveredSkill[] {
  if (!query?.trim()) return skills;
  const q = query.trim().toLowerCase();
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q),
  );
}
