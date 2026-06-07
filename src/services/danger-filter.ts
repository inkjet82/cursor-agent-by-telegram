import path from "node:path";
import { PROJECT_ROOT } from "../env.js";
import { readJsonFile } from "../utils/fs-store.js";

export interface DangerRule {
  id: string;
  label: string;
  patterns: string[];
}

export interface DangerFilterConfig {
  version: number;
  rules: DangerRule[];
}

export interface DangerAssessment {
  blocked: boolean;
  ruleId?: string;
  ruleLabel?: string;
  matchedPattern?: string;
}

let cachedConfig: DangerFilterConfig | null = null;

export async function loadDangerFilterConfig(): Promise<DangerFilterConfig> {
  if (cachedConfig) return cachedConfig;
  cachedConfig = await readJsonFile<DangerFilterConfig>(
    path.join(PROJECT_ROOT, "config", "danger-filter.json"),
    { version: 1, rules: [] },
  );
  return cachedConfig;
}

function compileRules(config: DangerFilterConfig): Array<{
  rule: DangerRule;
  regex: RegExp;
}> {
  const compiled: Array<{ rule: DangerRule; regex: RegExp }> = [];
  for (const rule of config.rules) {
    for (const pattern of rule.patterns) {
      try {
        compiled.push({ rule, regex: new RegExp(pattern, "i") });
      } catch (err) {
        console.warn(`[danger-filter] invalid pattern in ${rule.id}: ${pattern}`, err);
      }
    }
  }
  return compiled;
}

export function assessDanger(
  text: string,
  config: DangerFilterConfig,
): DangerAssessment {
  const haystack = text.trim();
  if (!haystack) return { blocked: false };

  for (const { rule, regex } of compileRules(config)) {
    const match = haystack.match(regex);
    if (match) {
      return {
        blocked: true,
        ruleId: rule.id,
        ruleLabel: rule.label,
        matchedPattern: match[0],
      };
    }
  }
  return { blocked: false };
}

export function assessDangerTexts(
  texts: string[],
  config: DangerFilterConfig,
): DangerAssessment {
  for (const text of texts) {
    const result = assessDanger(text, config);
    if (result.blocked) return result;
  }
  return { blocked: false };
}

export function formatDangerBlockMessage(assessment: DangerAssessment): string {
  const label = assessment.ruleLabel ?? assessment.ruleId ?? "unknown";
  return [
    "⛔ 위험 명령으로 차단되었습니다.",
    `규칙: ${label}`,
    assessment.matchedPattern ? `매칭: ${assessment.matchedPattern}` : null,
    "",
    "설정 → 「위험감지」 OFF 시에만 실행됩니다 (비권장).",
  ]
    .filter(Boolean)
    .join("\n");
}
