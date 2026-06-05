import path from "node:path";
import type { WorkspaceEntry } from "../types.js";

export function aliasFromPath(folderPath: string): string {
  const base = path.basename(folderPath.replace(/[/\\]+$/, ""));
  return base.replace(/\s+/g, "-").slice(0, 32) || "workspace";
}

/** Windows drive letter, UNC, or Unix absolute path */
export function looksLikeFolderPath(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  if (/^[a-zA-Z]:[\\/]/.test(t)) return true;
  if (t.startsWith("\\\\")) return true;
  if (t.startsWith("/") || t.startsWith("~")) return true;
  return t.includes("\\") || (t.includes("/") && t.includes(":"));
}

export function formatWorkspacesPickerText(
  entries: WorkspaceEntry[],
  activePath: string,
): string {
  const lines = [
    "워크스페이스 선택",
    "Agent cwd·스킬 검색 경로가 여기로 바뀝니다.",
    "/workspace 경로 등록 · /workspaces 목록",
    "",
  ];
  for (const e of entries) {
    const mark = e.path === activePath ? "✓" : "○";
    lines.push(`${mark} ${e.alias}`);
    lines.push(`  ${e.path}`);
  }
  return lines.join("\n");
}
