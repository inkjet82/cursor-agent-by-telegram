import { readJsonFile } from "../utils/fs-store.js";
import path from "node:path";
import { PROJECT_ROOT } from "../env.js";
import type { AgentMode, ModelParam } from "../types.js";
import type { Env } from "../env.js";

export type ModelParamsMap = Record<string, ModelParam[]>;

export interface ModelEnvConfig {
  defaultMode: AgentMode;
  paramsByModel: ModelParamsMap;
  /** If true, Telegram UI cannot change params (always .env/config) */
  paramsLock: boolean;
  /** If true, picking a model resets params to env default for that model */
  resetParamsOnModelChange: boolean;
}

function parseModelParamsJson(raw: string | undefined): ModelParamsMap {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as ModelParamsMap;
    for (const [modelId, params] of Object.entries(parsed)) {
      if (!Array.isArray(params)) {
        throw new Error(`MODEL_DEFAULT_PARAMS.${modelId} must be an array`);
      }
      for (const p of params) {
        if (!p.id || p.value === undefined) {
          throw new Error(`Invalid param for ${modelId}`);
        }
      }
    }
    return parsed;
  } catch (e) {
    console.warn("MODEL_DEFAULT_PARAMS parse failed:", e);
    return {};
  }
}

async function loadFileParams(): Promise<ModelParamsMap> {
  return readJsonFile<ModelParamsMap>(
    path.join(PROJECT_ROOT, "config", "model-params.json"),
    {},
  );
}

function mergeParamsMaps(
  base: ModelParamsMap,
  overlay: ModelParamsMap,
): ModelParamsMap {
  return { ...base, ...overlay };
}

export async function loadModelEnvConfig(env: Env): Promise<ModelEnvConfig> {
  const fileParams = await loadFileParams();
  const envParams = parseModelParamsJson(env.MODEL_DEFAULT_PARAMS);
  const paramsByModel = mergeParamsMaps(fileParams, envParams);

  const defaultMode = (env.DEFAULT_MODE ?? "ask") as AgentMode;
  if (!["ask", "plan", "agent", "smart"].includes(defaultMode)) {
    throw new Error(`Invalid DEFAULT_MODE: ${defaultMode}`);
  }

  return {
    defaultMode,
    paramsByModel,
    paramsLock: env.MODEL_PARAMS_LOCK === "true",
    resetParamsOnModelChange: env.MODEL_PARAMS_RESET_ON_MODEL_CHANGE !== "false",
  };
}

export function paramsForModel(
  config: ModelEnvConfig,
  modelId: string,
): ModelParam[] {
  return config.paramsByModel[modelId]?.map((p) => ({ ...p })) ?? [];
}

export function formatParamsLine(params: ModelParam[]): string {
  if (!params.length) return "(기본값 없음)";
  return params.map((p) => `${p.id}=${p.value}`).join(", ");
}
