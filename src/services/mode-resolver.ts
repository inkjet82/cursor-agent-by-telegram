import type { AgentMode } from "../types.js";

export function resolveSmartMode(text: string): Exclude<AgentMode, "smart"> {
  const lower = text.toLowerCase();
  if (
    /plan|설계|계획|구조|how should|approach|strategy/.test(lower)
  ) {
    return "plan";
  }
  if (
    /fix|implement|refactor|고쳐|수정|구현|만들어|추가해|create|build|write/.test(
      lower,
    )
  ) {
    return "agent";
  }
  return "ask";
}

export function resolveModeForText(
  text: string,
  defaultMode: AgentMode,
  explicit?: AgentMode,
): Exclude<AgentMode, "smart"> {
  if (explicit && explicit !== "smart") return explicit;
  if (defaultMode === "smart") return resolveSmartMode(text);
  return defaultMode;
}
