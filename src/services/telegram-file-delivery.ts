import fs from "node:fs/promises";
import { glob } from "node:fs/promises";
import path from "node:path";
import { InputFile } from "grammy";
import type { Api } from "grammy";
import { assertWorkspaceInRoots, resolveWorkspacePath } from "../utils/paths.js";
import { loadWorkspacesConfig } from "../store/defaults.js";

const MAX_FILE_BYTES = 48 * 1024 * 1024;
const MAX_FILES = 5;
const MIN_MATCH_SCORE = 8;
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

/** 특정 파일 1개 요청(여러 개·전체 요청 제외) */
export function wantsSingleFile(prompt: string): boolean {
  return !/(모두|전부|전체|all\b|파일들|여러|2개|두\s*개|세\s*개)/i.test(prompt);
}

/** 프롬프트에서 파일명 매칭용 검색어 */
export function extractSearchTerms(prompt: string): string[] {
  const terms = new Set<string>();
  for (const m of prompt.matchAll(/\d{8}/g)) terms.add(m[0]!);
  for (const m of prompt.match(/[\uac00-\ud7a3]{2,}/g) ?? []) {
    terms.add(m.toLowerCase());
    if (m.length >= 4) {
      for (let i = 0; i <= m.length - 2; i++) {
        const sub = m.slice(i, i + 2);
        if (sub.length >= 2) terms.add(sub);
      }
    }
  }
  for (const m of prompt.match(/\b[a-z][a-z0-9_-]{2,}\b/gi) ?? []) {
    terms.add(m.toLowerCase());
  }
  return [...terms].filter((t) => t.length >= 2);
}

export function scoreCandidate(filePath: string, prompt: string): number {
  const lower = prompt.toLowerCase();
  const base = path.basename(filePath).toLowerCase();
  const dir = path.dirname(filePath).toLowerCase();
  const isPlan = base.endsWith(".plan.md");
  let score = 0;

  if (isPlan) {
    if (/(plan|플랜)/i.test(lower)) score += 10;
    else return 0;
  }

  for (const term of extractSearchTerms(prompt)) {
    if (base.includes(term)) {
      score += term.length >= 4 ? 10 : term.length >= 3 ? 7 : 4;
    }
    if (dir.includes(term)) score += 2;
  }

  if (/20260606/.test(lower) && /20260606/.test(base)) score += 14;
  if (/점검|검토/.test(lower) && /점검|검토/.test(base)) score += 10;
  if (/미디어/.test(lower) && /미디어/.test(base)) score += 10;
  if (/워크플로우/.test(lower) && /워크플로우/.test(base)) score += 10;

  if (base.endsWith(".md") && !isPlan) score += 1;

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

function pickBestMatches(
  scored: Map<string, number>,
  prompt: string,
): string[] {
  const ranked = [...scored.entries()]
    .filter(([, s]) => s >= MIN_MATCH_SCORE)
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0) return [];

  const limit = wantsSingleFile(prompt) ? 1 : MAX_FILES;
  const top = ranked.slice(0, limit);

  if (
    wantsSingleFile(prompt) &&
    ranked.length > 1 &&
    ranked[0]![1] - ranked[1]![1] < 4
  ) {
    return [ranked[0]![0]];
  }

  return top.map(([p]) => p);
}

async function searchWorkspace(
  workspacePath: string,
  prompt: string,
): Promise<string[]> {
  const roots: string[] = [workspacePath];
  const wantPlan = /(plan|플랜)/i.test(prompt);

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
        const lower = rel.toLowerCase();
        const isPlan = lower.endsWith(".plan.md");
        if (isPlan && !wantPlan) continue;
        const ext = path.extname(rel).toLowerCase();
        if (!isPlan && ![".md", ".txt", ".json", ".pdf"].includes(ext)) continue;
        const s = scoreCandidate(full, prompt);
        if (s >= MIN_MATCH_SCORE) {
          scored.set(full, Math.max(scored.get(full) ?? 0, s));
        }
      }
    } catch {
      /* ignore unreadable root */
    }
  }

  return pickBestMatches(scored, prompt);
}

/** 워크스페이스에서 요청에 맞는 파일 경로 탐색 */
export async function resolveFilesFromRequest(
  prompt: string,
  workspacePath: string,
): Promise<string[]> {
  const literal = extractPathLiterals(prompt, workspacePath);
  const fromLiteral: string[] = [];
  for (const p of literal) {
    if (await isSendableFile(p, workspacePath)) {
      fromLiteral.push(resolveWorkspacePath(p));
    }
  }
  if (fromLiteral.length) {
    const limit = wantsSingleFile(prompt) ? 1 : MAX_FILES;
    return [...new Set(fromLiteral)].slice(0, limit);
  }

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
    /(?:^|[\s`"'(\[])((?:[\w.-]+[\\/])+[\w.-]+\.(?:md|txt|json|pdf))/gim;
  for (const m of text.matchAll(relMd)) {
    const joined = m[1]!;
    if (joined.toLowerCase().endsWith(".plan.md")) continue;
    found.add(path.join(workspacePath, joined.replace(/\//g, path.sep)));
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

async function collectRankedPaths(
  workspacePath: string,
  userPrompt: string,
  agentText?: string,
): Promise<string[]> {
  const scored = new Map<string, number>();

  if (wantsFileDelivery(userPrompt)) {
    for (const p of await resolveFilesFromRequest(userPrompt, workspacePath)) {
      scored.set(p, scoreCandidate(p, userPrompt));
    }
  }

  if (agentText) {
    for (const p of extractPathsFromAgentText(agentText, workspacePath)) {
      if (!(await isSendableFile(p, workspacePath))) continue;
      const resolved = resolveWorkspacePath(p);
      const s = scoreCandidate(resolved, userPrompt);
      if (s >= MIN_MATCH_SCORE) {
        scored.set(resolved, Math.max(scored.get(resolved) ?? 0, s));
      }
    }
  }

  return pickBestMatches(scored, userPrompt);
}

/** 요청·응답에서 파일을 찾아 Telegram 문서로 전송 */
export async function tryDeliverFilesForTurn(
  api: Api,
  chatId: number,
  workspacePath: string,
  userPrompt: string,
  agentText?: string,
): Promise<string[]> {
  const paths = await collectRankedPaths(
    workspacePath,
    userPrompt,
    agentText,
  );
  if (paths.length === 0) return [];
  return deliverWorkspaceFiles(api, chatId, paths, workspacePath);
}

export function fileDeliveryAgentHint(): string {
  return `[TELEGRAM_BOT]
The Telegram bot will attach matching files automatically as documents.
Do NOT say you cannot attach files. Do not paste long file bodies.
Reply briefly in Korean (1-2 sentences). You may mention the file basename only.
[/TELEGRAM_BOT]

`;
}
