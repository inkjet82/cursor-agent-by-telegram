import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "node:fs/promises";
import { resolveWorkspacePath } from "../utils/paths.js";

const MIN_AGENT_TEXT_LEN = 200;
const PLAN_SCAN_GRACE_MS = 30_000;
async function readPlanFile(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > 512 * 1024) return null;
    return (await fs.readFile(filePath, "utf-8")).trim();
  } catch {
    return null;
  }
}

async function findRecentPlanFiles(
  workspacePath: string,
  runStartedAt: number,
): Promise<Array<{ path: string; mtimeMs: number }>> {
  const root = resolveWorkspacePath(workspacePath);
  const patterns = [
    path.join(root, ".cursor", "plans", "**", "*.plan.md"),
    path.join(root, "**", "*.plan.md"),
  ];
  const found = new Map<string, number>();

  for (const pattern of patterns) {
    try {
      for await (const entry of glob(pattern)) {
        const stat = await fs.stat(entry).catch(() => null);
        if (!stat?.isFile()) continue;
        const mtimeMs = stat.mtimeMs;
        const prev = found.get(entry);
        if (prev === undefined || mtimeMs > prev) found.set(entry, mtimeMs);
      }
    } catch {
      // ignore glob errors
    }
  }

  const graceStart = runStartedAt - PLAN_SCAN_GRACE_MS;
  const all = [...found.entries()].map(([p, mtimeMs]) => ({ path: p, mtimeMs }));
  const recent = all.filter((f) => f.mtimeMs >= graceStart);
  const pool = recent.length > 0 ? recent : all;
  pool.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return pool;
}

export async function resolvePlanBody(
  workspacePath: string,
  agentText: string,
  runStartedAt: number,
): Promise<{ body: string; source: "agent" | "file"; filePath?: string }> {
  const trimmed = agentText.trim();
  if (trimmed.length >= MIN_AGENT_TEXT_LEN) {
    return { body: trimmed, source: "agent" };
  }

  const candidates = await findRecentPlanFiles(workspacePath, runStartedAt);
  for (const candidate of candidates.slice(0, 3)) {
    const content = await readPlanFile(candidate.path);
    if (content && content.length >= 80) {
      return { body: content, source: "file", filePath: candidate.path };
    }
  }

  if (trimmed) {
    return {
      body: `${trimmed}\n\n(Plan 본문 파일을 찾지 못했습니다. 워크스페이스 .cursor/plans 를 확인하세요.)`,
      source: "agent",
    };
  }

  return {
    body: "(Plan 본문이 비어 있습니다. 다시 /plan 으로 요청하거나 [계획 수정]을 사용하세요.)",
    source: "agent",
  };
}
