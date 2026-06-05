import type { ModelSelection } from "@cursor/sdk";
import type { ModelEnvConfig } from "../config/model-env.js";
import { paramsForModel } from "../config/model-env.js";
import type { ModelParam, UserState } from "../types.js";
import type { ModelCatalog } from "./model-catalog.js";

export async function buildModelSelection(
  catalog: ModelCatalog,
  modelConfig: ModelEnvConfig,
  state: UserState,
): Promise<ModelSelection> {
  const cat = await catalog.get(state.modelId);
  const envDefaults = paramsForModel(modelConfig, state.modelId);
  const params = catalog.resolveEffectiveParams(
    state.modelId,
    cat,
    envDefaults,
    state.modelParams,
    modelConfig.paramsLock,
  );
  return catalog.toModelSelection(state.modelId, params);
}

export function defaultParamsForModelChange(
  modelConfig: ModelEnvConfig,
  modelId: string,
): ModelParam[] {
  if (modelConfig.resetParamsOnModelChange) {
    return paramsForModel(modelConfig, modelId);
  }
  return [];
}
