import fs from "node:fs/promises";
import { glob } from "node:fs/promises";
import path from "node:path";
import { InputFile } from "grammy";
import type { Api } from "grammy";
import { assertWorkspaceInRoots, resolveWorkspacePath } from "../utils/paths.js";
import { loadWorkspacesConfig } from "../store/defaults.js";

const MAX_FILE_BYTES = 48 * 1024 * 1024;
const MAX_FILES = 5;
const SENDABLE_EXT = new Set([
  ".md",
  ".txt",
  ".json",
  ".pdf",
  ".csv",
  ".xml",
  ".yaml",
  ".yml",
  ".html",
  ".plan.md",
]);

/** 사용자가 파일 첨부를 원하는지 (내용만 보여달라는 요청 제외) */
export function wantsFileDelivery(prompt: string): boolean {
  const p = prompt.trim();
  if (!/(보내|보내줘|보내주|전송|첨부|공유|attach|upload|send\s)/i.test(p)) {
    return false;
  }
  if (/(알려|보여|설명|요약|내용만|텍스트로)/i.test(p) && !/(파일|첨부|document)/i.test(p)) {
    return false;
  }
  return /(파일|file|문서|첨부|\.md|\.pdf|\.txt|플랜|plan)/i.test(p) || /보내/i.test(p);
}

function scoreCandidate(filePath: string, prompt: string): number {
  const lower = prompt.toLowerCase();
  const base = path.basename(filePath).toLowerCase();
  const dir = path.dirname(filePath).toLowerCase();
  let score = 0;

  if (/2일|이름분류/.test(lower) && /2일|이름분류/.test(dir)) score += 12;
  if (/(message|메시지|telegram)/i.test(lower)) {
    if (/message|telegram|pnpm/.test(base)) score += 10;
    if (/message|telegram|pnpm/.test(dir)) score += 4;
  }
  if (/(plan|플랜)/i.test(lower)) {
    if (base.includes("plan") || base.endsWith(".plan.md")) score += 10;
  }
  if (base.endsWith(".plan.md")) score += 3;
  if (base.endsWith(".md")) score += 1;

  return score;
}

async function isSendableFile(
  filePath: string,
  workspacePath: string,
): Promise<boolean> {
  try {
    const config = await loadWorkspacesConfig();
    const resolved = resolveWorkspacePath(filePath);
    assertWorkspaceInRoots(resolved, config.roots);
    const rel = path.relative(resolveWorkspacePath(workspacePath), resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return false;

    const stat = await fs.stat(resolved);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return false;

    const ext = path.basename(resolved).includes(".plan.md")
      ? ".plan.md"
      : path.extname(resolved).toLowerCase();
    return SENDABLE_EXT.has(ext);
  } catch {
    return false;
  }
}

function extractPathLiterals(prompt: string, workspacePath: string): string[] {
  const found: string[] = [];
  const win = /[A-Za-z]:\\(?:[^\\:*?"<>|\r\n]+\\)*[^\\:*?"<>|\r\n]*/g;
  const unix = /(?:^|\s)(\/(?:[^\s/]+\/)*[^\s/]+\.[a-z0-9]+)/gi;
  for (const m of prompt.matchAll(win)) found.push(m[0]);
  for (const m of prompt.matchAll(unix)) found.push(m[1]!);

  const rel = /(?:^|\s)((?:[\w.-]+[\\/])+[\w.-]+\.(?:md|txt|json|pdf))/gi;
  for (const m of prompt.matchAll(rel)) {
    found.push(path.join(workspacePath, m[1]!.replace(/\//g, path.sep)));
  }
  return found;
}

async function searchWorkspace(
  workspacePath: string,
  prompt: string,
): Promise<string[]> {
  const roots: string[] = [workspacePath];
  if (/2일|이름분류/.test(prompt)) {
    try {
      const entries = await fs.readdir(workspacePath, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && /2일|이름분류/.test(e.name)) {
          roots.push(path.join(workspacePath, e.name));
        }
      }
    } catch {
      /* ignore */
    }
  }

  const scored = new Map<string, number>();
  for (const root of roots) {
    try {
      for await (const rel of glob("**/*", { cwd: root })) {
        const full = path.join(root, rel);
        if (rel.includes("node_modules") || rel.includes(".git")) continue;
        const ext = path.extname(rel).toLowerCase();
        const isPlan = rel.toLowerCase().endsWith(".plan.md");
        if (!isPlan && ![".md", ".txt", ".json", ".pdf"].includes(ext)) continue;
        const s = scoreCandidate(full, prompt);
        if (s > 0) scored.set(full, Math.max(scored.get(full) ?? 0, s));
      }
      for await (const rel of glob("**/*.plan.md", { cwd: root })) {
        const full = path.join(root, rel);
        if (rel.includes("node_modules")) continue;
        const s = scoreCandidate(full, prompt);
        if (s > 0) scored.set(full, Math.max(scored.get(full) ?? 0, s));
      }
    } catch {
      /* ignore unreadable root */
    }
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_FILES)
    .map(([p]) => p);
}

/** 워크스페이스에서 요청에 맞는 파일 경로 탐색 */
export async function resolveFilesFromRequest(
  prompt: string,
  workspacePath: string,
): Promise<string[]> {
  const literal = extractPathLiterals(prompt, workspacePath);
  const fromLiteral: string[] = [];
  for (const p of literal) {
    if (await isSendableFile(p, workspacePath)) fromLiteral.push(resolveWorkspacePath(p));
  }
  if (fromLiteral.length) return [...new Set(fromLiteral)].slice(0, MAX_FILES);

  const searched = await searchWorkspace(workspacePath, prompt);
  const ok: string[] = [];
  for (const p of searched) {
    if (await isSendableFile(p, workspacePath)) ok.push(resolveWorkspacePath(p));
  }
  return ok;
}

/** 에이전트 응답에 적힌 절대/상대 경로 */
export function extractPathsFromAgentText(
  text: string,
  workspacePath: string,
): string[] {
  const found = new Set<string>();
  const win = /[A-Za-z]:\\(?:[^\\:*?"<>|\r\n]+\\)*[^\\:*?"<>|\r\n]*/g;
  for (const m of text.matchAll(win)) found.add(m[0]);
  const relMd =
    /(?:^|[\s`"'(\[])((?:[\w.-]+[\\/])+[\w.-]+\.(?:md|plan\.md|txt|json|pdf))/gim;
  for (const m of text.matchAll(relMd)) {
    found.add(path.join(workspacePath, m[1]!.replace(/\//g, path.sep)));
  }
  return [...found];
}

export async function deliverWorkspaceFiles(
  api: Api,
  chatId: number,
  filePaths: string[],
  workspacePath: string,
): Promise<string[]> {
  const sent: string[] = [];
  for (const filePath of filePaths.slice(0, MAX_FILES)) {
    if (!(await isSendableFile(filePath, workspacePath))) continue;
    const resolved = resolveWorkspacePath(filePath);
    const name = path.basename(resolved);
    try {
      await api.sendDocument(chatId, new InputFile(resolved), {
        caption: name,
      });
      sent.push(resolved);
    } catch (err) {
      console.warn(`sendDocument failed for ${resolved}:`, err);
    }
  }
  return sent;
}

/** 요청·응답에서 파일을 찾아 Telegram 문서로 전송 */
export async function tryDeliverFilesForTurn(
  api: Api,
  chatId: number,
  workspacePath: string,
  userPrompt: string,
  agentText?: string,
): Promise<string[]> {
  const paths = new Set<string>();

  if (wantsFileDelivery(userPrompt)) {
    for (const p of await resolveFilesFromRequest(userPrompt, workspacePath)) {
      paths.add(p);
    }
  }

  if (agentText) {
    for (const p of extractPathsFromAgentText(agentText, workspacePath)) {
      if (await isSendableFile(p, workspacePath)) paths.add(resolveWorkspacePath(p));
    }
  }

  if (paths.size === 0) return [];
  return deliverWorkspaceFiles(api, chatId, [...paths], workspacePath);
}

export function fileDeliveryAgentHint(): string {
  return `[TELEGRAM_BOT]
The user wants files delivered as Telegram document attachments, NOT full file contents in chat.
Do not paste long file bodies. Reply briefly in Korean. If you reference a file, give its full path only.
[/TELEGRAM_BOT]

`;
}
