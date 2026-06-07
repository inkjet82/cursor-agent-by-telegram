import fs from "node:fs/promises";
import type { DiscoveredSkill } from "../types.js";
import type { AgentMode } from "../types.js";

const MODE_PREFIX: Record<Exclude<AgentMode, "smart">, string> = {
  ask: `[MODE: ASK — Read-only exploration. Do NOT modify files or run shell commands that change state. Answer and analyze only.]

`,
  plan: `[MODE: PLAN — Produce an implementation plan with steps and risks. Do NOT modify files or execute write/shell operations yet.

The user may revise this plan in follow-up messages. Do NOT write "## 계획 완료" — the Telegram bot finalizes plans only when the user sends /done.]

`,
  agent: `[MODE: AGENT — Implement the request in the workspace. Run tools as needed to complete the task.]

`,
};

export async function readSkillBody(filePath: string): Promise<string> {
  const raw = await fs.readFile(filePath, "utf-8");
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

export async function buildPrompt(
  userText: string,
  mode: Exclude<AgentMode, "smart">,
  options: {
    skills: DiscoveredSkill[];
    force?: boolean;
    prefix?: string;
  },
): Promise<string> {
  const parts: string[] = [];
  if (options.prefix) parts.push(options.prefix);

  for (const skill of options.skills) {
    const body = await readSkillBody(skill.filePath);
    parts.push(
      `[SKILL: ${skill.name}]\n${body}\n[/SKILL: ${skill.name}]\n\n`,
    );
  }

  parts.push(MODE_PREFIX[mode]);

  if (mode === "agent" && options.force) {
    parts.push(
      `[USER PREFERENCE: Proceed without asking for confirmation when running safe commands.]\n\n`,
    );
  }

  parts.push(userText.trim());
  return parts.join("");
}
