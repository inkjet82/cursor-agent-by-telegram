import path from "node:path";
import { PROJECT_ROOT } from "../env.js";
import { readJsonFile, writeJsonFile } from "../utils/fs-store.js";
import type { WorkspaceEntry, WorkspacesConfig } from "../types.js";
import { loadWorkspacesConfig } from "./defaults.js";
import {
  assertWorkspaceInRoots,
  resolveWorkspacePath,
  workspaceExists,
} from "../utils/paths.js";

interface UserWorkspacesFile {
  entries: Array<{
    alias: string;
    path: string;
    isDefault?: boolean;
  }>;
}

const USER_WS_PATH = path.join(PROJECT_ROOT, "data", "workspaces.user.json");

export class WorkspaceStore {
  async listEntries(): Promise<WorkspaceEntry[]> {
    const config = await loadWorkspacesConfig();
    const user = await readJsonFile<UserWorkspacesFile>(USER_WS_PATH, {
      entries: [],
    });

    const map = new Map<string, WorkspaceEntry>();

    for (const [alias, p] of Object.entries(config.aliases)) {
      map.set(alias, {
        alias,
        path: resolveWorkspacePath(p),
        isDefault: config.defaultAlias === alias,
        source: "config",
      });
    }

    for (const e of user.entries) {
      map.set(e.alias, {
        alias: e.alias,
        path: resolveWorkspacePath(e.path),
        isDefault: e.isDefault,
        source: "user",
      });
    }

    return [...map.values()];
  }

  async getByAlias(alias: string): Promise<WorkspaceEntry | undefined> {
    const all = await this.listEntries();
    return all.find((e) => e.alias === alias);
  }

  async getDefaultPath(): Promise<string> {
    const all = await this.listEntries();
    const def = all.find((e) => e.isDefault) ?? all[0];
    return def?.path ?? PROJECT_ROOT;
  }

  async addUserEntry(alias: string, folderPath: string, asDefault = false): Promise<void> {
    const resolved = resolveWorkspacePath(folderPath);
    if (!workspaceExists(resolved)) {
      throw new Error("폴더가 존재하지 않습니다.");
    }
    const config = await loadWorkspacesConfig();
    assertWorkspaceInRoots(resolved, config.roots);

    const user = await readJsonFile<UserWorkspacesFile>(USER_WS_PATH, {
      entries: [],
    });

    let entries = user.entries.filter((e) => e.alias !== alias);
    if (asDefault) {
      entries = entries.map((e) => ({ ...e, isDefault: false }));
    }
    entries.push({ alias, path: resolved, isDefault: asDefault });

    await writeJsonFile(USER_WS_PATH, { entries });
  }

  async setDefaultAlias(alias: string): Promise<void> {
    const entry = await this.getByAlias(alias);
    if (!entry) throw new Error("알 수 없는 별칭입니다.");

    if (entry.source === "user") {
      const user = await readJsonFile<UserWorkspacesFile>(USER_WS_PATH, {
        entries: [],
      });
      const entries = user.entries.map((e) => ({
        ...e,
        isDefault: e.alias === alias,
      }));
      if (!entries.some((e) => e.alias === alias)) {
        entries.push({ alias, path: entry.path, isDefault: true });
      }
      await writeJsonFile(USER_WS_PATH, { entries });
    }
    // config aliases: update user state only (handled by caller)
  }

  async removeUserEntry(alias: string): Promise<boolean> {
    const user = await readJsonFile<UserWorkspacesFile>(USER_WS_PATH, {
      entries: [],
    });
    const before = user.entries.length;
    user.entries = user.entries.filter((e) => e.alias !== alias);
    if (user.entries.length === before) return false;
    await writeJsonFile(USER_WS_PATH, { entries: user.entries });
    return true;
  }

  getProfile(config: WorkspacesConfig, alias?: string) {
    if (!alias || !config.profiles) return undefined;
    return config.profiles[alias];
  }
}
