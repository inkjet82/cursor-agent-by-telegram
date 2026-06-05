import type { ModelUsageSlice } from "./types.js";

/** Heuristic: Composer / Auto bucket vs named API models (from usage events). */
export function isAutoUsageModel(model: string): boolean {
  const m = model.toLowerCase();
  if (m.includes("composer")) return true;
  if (m.includes("auto")) return true;
  if (m === "default" || m === "cursor-small") return true;
  return false;
}

export function shortenModelName(model: string): string {
  if (model.length <= 28) return model;
  return `${model.slice(0, 25)}…`;
}

export function aggregateModelUsage(
  events: Array<{ model: string; chargedCents: number }>,
): { auto: ModelUsageSlice[]; api: ModelUsageSlice[] } {
  const byModel = new Map<string, number>();
  for (const e of events) {
    if (!e.model || e.chargedCents <= 0) continue;
    byModel.set(e.model, (byModel.get(e.model) ?? 0) + e.chargedCents);
  }

  const autoMap = new Map<string, number>();
  const apiMap = new Map<string, number>();
  for (const [model, cents] of byModel) {
    if (isAutoUsageModel(model)) {
      autoMap.set(model, (autoMap.get(model) ?? 0) + cents);
    } else {
      apiMap.set(model, (apiMap.get(model) ?? 0) + cents);
    }
  }

  return {
    auto: toSlices(autoMap),
    api: toSlices(apiMap),
  };
}

function toSlices(map: Map<string, number>): ModelUsageSlice[] {
  const total = [...map.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  return [...map.entries()]
    .map(([model, cents]) => ({
      model,
      cents,
      percentOfCategory: Math.round((cents / total) * 1000) / 10,
    }))
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 8);
}
