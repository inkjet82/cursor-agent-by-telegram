import { readJsonFile } from "../utils/fs-store.js";
import type { UserState, WorkspacesConfig } from "../types.js";
import path from "node:path";
import { PROJECT_ROOT, type Env } from "../env.js";
import { resolveWorkspacePath, workspaceExists } from "../utils/paths.js";
import { loadModelEnvConfig, paramsForModel } from "../config/model-env.js";

interface BotDefaults {
  defaultMode: UserState["defaultMode"];
  modelId: string;
  skillSettingSources: UserState["skillSettingSources"];
  force: boolean;
  dangerDetection: boolean;
}

export async function loadWorkspacesConfig(): Promise<WorkspacesConfig> {
  return readJsonFile<WorkspacesConfig>(
    path.join(PROJECT_ROOT, "config", "workspaces.json"),
    { aliases: { telegram: PROJECT_ROOT }, defaultAlias: "telegram" },
  );
}

export async function loadBotDefaults(): Promise<BotDefaults> {
  return readJsonFile<BotDefaults>(
    path.join(PROJECT_ROOT, "config", "bot.defaults.json"),
    {
      defaultMode: "ask",
      modelId: "composer-2",
      skillSettingSources: ["project", "user"],
      force: false,
      dangerDetection: true,
    },
  );
}

export async function defaultUserState(env: Env): Promise<UserState> {
  const [wsConfig, defaults, modelConfig] = await Promise.all([
    loadWorkspacesConfig(),
    loadBotDefaults(),
    loadModelEnvConfig(env),
  ]);
  const alias = wsConfig.defaultAlias ?? Object.keys(wsConfig.aliases)[0];
  const rawPath = alias ? wsConfig.aliases[alias] : PROJECT_ROOT;
  const workspacePath = resolveWorkspacePath(rawPath);
  const modelId = env.DEFAULT_MODEL_ID ?? defaults.modelId;

  return {
    defaultMode: modelConfig.defaultMode ?? defaults.defaultMode,
    workspacePath: workspaceExists(workspacePath) ? workspacePath : PROJECT_ROOT,
    workspaceAlias: alias,
    modelId,
    modelParams: paramsForModel(modelConfig, modelId),
    force: defaults.force,
    dangerDetection: defaults.dangerDetection ?? true,
    pendingSkillNames: [],
    skillSettingSources: defaults.skillSettingSources,
  };
}
