import path from "node:path";
import { PROJECT_ROOT } from "../env.js";
import { readJsonFile, writeJsonFile } from "../utils/fs-store.js";
import type { UserState } from "../types.js";
import { defaultUserState } from "./defaults.js";
import type { Env } from "../env.js";

type StateFile = Record<string, UserState>;

const STATE_PATH = path.join(PROJECT_ROOT, "data", "state.json");

export class UserStateStore {
  constructor(private env: Env) {}

  private cache: StateFile | null = null;

  private async loadAll(): Promise<StateFile> {
    if (!this.cache) {
      this.cache = await readJsonFile<StateFile>(STATE_PATH, {});
    }
    return this.cache;
  }

  private async saveAll(data: StateFile): Promise<void> {
    this.cache = data;
    await writeJsonFile(STATE_PATH, data);
  }

  private migrateState(s: UserState): boolean {
    let changed = false;
    const legacy = s as UserState & {
      pinnedSkillNames?: string[];
      oneShotSkillName?: string;
    };
    if (!s.pendingSkillNames) {
      const pending = new Set<string>();
      for (const n of legacy.pinnedSkillNames ?? []) pending.add(n);
      if (legacy.oneShotSkillName) pending.add(legacy.oneShotSkillName);
      s.pendingSkillNames = [...pending];
      changed = true;
    }
    if ("pinnedSkillNames" in legacy) {
      delete legacy.pinnedSkillNames;
      changed = true;
    }
    if ("oneShotSkillName" in legacy) {
      delete legacy.oneShotSkillName;
      changed = true;
    }
    return changed;
  }

  async get(userId: number): Promise<UserState> {
    const all = await this.loadAll();
    const key = String(userId);
    if (!all[key]) {
      all[key] = await defaultUserState(this.env);
      await this.saveAll(all);
    }
    const s = all[key];
    let changed = false;
    if (!s.modelParams) {
      s.modelParams = [];
      changed = true;
    }
    if (this.migrateState(s)) changed = true;
    if (changed) await this.saveAll(all);
    return s;
  }

  async update(userId: number, patch: Partial<UserState>): Promise<UserState> {
    const all = await this.loadAll();
    const key = String(userId);
    const current = all[key] ?? (await defaultUserState(this.env));
    all[key] = { ...current, ...patch };
    await this.saveAll(all);
    return all[key];
  }
}
