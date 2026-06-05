import path from "node:path";
import { randomUUID } from "node:crypto";
import { PROJECT_ROOT } from "../env.js";
import { readJsonFile, writeJsonFile } from "../utils/fs-store.js";
import type { SessionRecord } from "../types.js";
import { previewText } from "../utils/paths.js";

type SessionsFile = Record<string, SessionRecord[]>;

const SESSIONS_PATH = path.join(PROJECT_ROOT, "data", "sessions.json");

export class SessionStore {
  private cache: SessionsFile | null = null;

  private async loadAll(): Promise<SessionsFile> {
    if (!this.cache) {
      this.cache = await readJsonFile<SessionsFile>(SESSIONS_PATH, {});
    }
    return this.cache;
  }

  private async saveAll(data: SessionsFile): Promise<void> {
    this.cache = data;
    await writeJsonFile(SESSIONS_PATH, data);
  }

  async listForUser(userId: number, workspacePath: string): Promise<SessionRecord[]> {
    const all = await this.loadAll();
    return (all[String(userId)] ?? []).filter(
      (s) => s.workspacePath === workspacePath,
    );
  }

  async getById(userId: number, sessionId: string): Promise<SessionRecord | undefined> {
    const all = await this.loadAll();
    return (all[String(userId)] ?? []).find((s) => s.id === sessionId);
  }

  async create(
    userId: number,
    agentId: string,
    workspacePath: string,
    label?: string,
  ): Promise<SessionRecord> {
    const all = await this.loadAll();
    const key = String(userId);
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id: randomUUID(),
      agentId,
      label: label ?? `세션 ${(all[key]?.length ?? 0) + 1}`,
      workspacePath,
      createdAt: now,
      lastUsedAt: now,
    };
    all[key] = [...(all[key] ?? []), record];
    await this.saveAll(all);
    return record;
  }

  async touch(
    userId: number,
    sessionId: string,
    promptPreview?: string,
  ): Promise<void> {
    const all = await this.loadAll();
    const key = String(userId);
    const list = all[key] ?? [];
    const idx = list.findIndex((s) => s.id === sessionId);
    if (idx < 0) return;
    list[idx] = {
      ...list[idx],
      lastUsedAt: new Date().toISOString(),
      lastPromptPreview: promptPreview
        ? previewText(promptPreview)
        : list[idx].lastPromptPreview,
    };
    all[key] = list;
    await this.saveAll(all);
  }

  async rename(userId: number, sessionId: string, label: string): Promise<void> {
    const all = await this.loadAll();
    const key = String(userId);
    all[key] = (all[key] ?? []).map((s) =>
      s.id === sessionId ? { ...s, label } : s,
    );
    await this.saveAll(all);
  }

  async remove(userId: number, sessionId: string): Promise<void> {
    const all = await this.loadAll();
    const key = String(userId);
    all[key] = (all[key] ?? []).filter((s) => s.id !== sessionId);
    await this.saveAll(all);
  }

  async importAgent(
    userId: number,
    agentId: string,
    workspacePath: string,
  ): Promise<SessionRecord> {
    const existing = (await this.listForUser(userId, workspacePath)).find(
      (s) => s.agentId === agentId,
    );
    if (existing) return existing;
    return this.create(userId, agentId, workspacePath, `가져온 ${agentId.slice(0, 8)}`);
  }
}
