import type { CatalogModel, ModelParam, UserState } from "../types.js";
import type { ModelEnvConfig } from "../config/model-env.js";
import { formatParamsLine, paramsForModel } from "../config/model-env.js";
import { InlineKeyboard } from "grammy";

export function formatModelStatus(
  state: UserState,
  modelConfig: ModelEnvConfig,
  catalog?: CatalogModel,
): string {
  const envP = paramsForModel(modelConfig, state.modelId);
  const lines = [
    `모델: ${state.modelId}`,
    `옵션(적용): ${formatParamsLine(
      state.modelParams.length && !modelConfig.paramsLock
        ? state.modelParams
        : envP.length
          ? envP
          : state.modelParams,
    )}`,
  ];
  if (modelConfig.paramsLock) {
    lines.push("🔒 MODEL_PARAMS_LOCK=true — .env/config 고정");
  } else {
    lines.push(`📁 .env 기본: ${formatParamsLine(envP)}`);
  }
  if (catalog?.parameters.length) {
    for (const def of catalog.parameters) {
      const vals = def.values
        .map((v) => v.displayName ?? v.value)
        .join(" | ");
      lines.push(`  · ${def.displayName ?? def.id}: ${vals}`);
    }
  }
  return lines.join("\n");
}

export function modelParamsKeyboard(
  modelId: string,
  catalog: CatalogModel,
  active: ModelParam[],
  locked: boolean,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (locked) {
    kb.text("🔒 .env 고정 (변경 불가)", "mp:noop").row();
    kb.text("닫기", "mp:close");
    return kb;
  }
  for (const def of catalog.parameters) {
    const current = active.find((p) => p.id === def.id)?.value;
    for (const v of def.values) {
      const label = v.displayName ?? v.value;
      const mark = current === v.value ? "✓ " : "";
      kb.text(`${mark}${def.id}=${label}`, `mp:set:${modelId}:${def.id}:${v.value}`).row();
    }
  }
  kb.text("↩ .env 기본으로", `mp:reset:${modelId}`).row();
  kb.text("닫기", "mp:close");
  return kb;
}
