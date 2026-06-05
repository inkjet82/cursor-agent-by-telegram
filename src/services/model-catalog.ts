import { Cursor, type ModelListItem } from "@cursor/sdk";
import type { CatalogModel, ModelParam, ModelParamDefinition } from "../types.js";
import type { ModelSelection } from "@cursor/sdk";

let cache: { at: number; models: CatalogModel[] } | null = null;
const CACHE_MS = 5 * 60 * 1000;

function mapItem(item: ModelListItem): CatalogModel {
  const parameters: ModelParamDefinition[] = (item.parameters ?? []).map(
    (p) => ({
      id: p.id,
      displayName: p.displayName,
      values: p.values.map((v) => ({
        value: v.value,
        displayName: v.displayName,
      })),
    }),
  );
  const variants = (item.variants ?? []).map((v) => ({
    params: v.params.map((p) => ({ id: p.id, value: p.value })),
    displayName: v.displayName,
    isDefault: v.isDefault,
  }));
  return {
    id: item.id,
    displayName: item.displayName,
    parameters,
    variants,
  };
}

export class ModelCatalog {
  constructor(private apiKey: string) {}

  async list(force = false): Promise<CatalogModel[]> {
    if (!force && cache && Date.now() - cache.at < CACHE_MS) {
      return cache.models;
    }
    const items = await Cursor.models.list({ apiKey: this.apiKey });
    const models = items.map(mapItem);
    cache = { at: Date.now(), models };
    return models;
  }

  async get(modelId: string): Promise<CatalogModel | undefined> {
    const models = await this.list();
    return models.find((m) => m.id === modelId);
  }

  resolveEffectiveParams(
    modelId: string,
    catalog: CatalogModel | undefined,
    envDefaults: ModelParam[],
    userParams: ModelParam[],
    useEnvOnly: boolean,
  ): ModelParam[] {
    if (useEnvOnly && envDefaults.length) return envDefaults.map((p) => ({ ...p }));
    if (userParams.length) return userParams.map((p) => ({ ...p }));
    if (envDefaults.length) return envDefaults.map((p) => ({ ...p }));
    const def = catalog?.variants?.find((v) => v.isDefault);
    if (def?.params?.length) return def.params.map((p) => ({ ...p }));
    return [];
  }

  toModelSelection(modelId: string, params: ModelParam[]): ModelSelection {
    if (!params.length) return { id: modelId };
    return {
      id: modelId,
      params: params.map((p) => ({ id: p.id, value: p.value })),
    };
  }
}
