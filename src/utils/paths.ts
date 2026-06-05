import fs from "node:fs";
import path from "node:path";

export function resolveWorkspacePath(input: string): string {
  return path.resolve(input);
}

/** Reject workspace paths outside configured roots (path traversal guard). */
export function assertWorkspaceInRoots(
  workspacePath: string,
  roots?: string[],
): void {
  if (!roots?.length) return;
  const resolved = resolveWorkspacePath(workspacePath);
  const ok = roots.some((root) => {
    const r = resolveWorkspacePath(root);
    const rel = path.relative(r, resolved);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
  if (!ok) {
    throw new Error(
      `워크스페이스가 허용 경로 밖입니다: ${resolved}\n허용 roots: ${roots.join(", ")}`,
    );
  }
}

export function workspaceExists(p: string): boolean {
  try {
    const stat = fs.statSync(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export function shortId(id: string, len = 8): string {
  return id.length <= len ? id : `${id.slice(0, len)}…`;
}

export function previewText(text: string, max = 80): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max)}…`;
}
