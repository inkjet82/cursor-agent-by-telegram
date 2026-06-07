export type AgentMode = "ask" | "plan" | "agent" | "smart";

export type SettingSource = "project" | "user" | "team" | "mdm" | "plugins";

export type WizardKind =
  | "workspace_add"
  | "workspace_add_alias"
  | "workspace_add_path"
  | "session_rename"
  | "skill_pick";

export interface UserWizard {
  kind: WizardKind;
  data?: Record<string, string>;
}

export interface ModelParam {
  id: string;
  value: string;
}

export interface PendingPlanApproval {
  sessionId: string;
  originalPrompt: string;
  planSummary: string;
  planMessageId: number;
}

export interface PlanDraft {
  originalPrompt: string;
  summary: string;
  updatedAt: string;
}

export interface UserState {
  defaultMode: AgentMode;
  workspacePath: string;
  workspaceAlias?: string;
  modelId: string;
  /** Active SDK model params; empty = use env defaults for current modelId */
  modelParams: ModelParam[];
  force: boolean;
  activeSessionId?: string;
  /** Skills to inject on the next user message only, then cleared */
  pendingSkillNames: string[];
  skillSettingSources: SettingSource[];
  pendingPlanApproval?: PendingPlanApproval;
  /** Plan 초안 — /done 전까지 실행 버튼 없음 */
  planDraft?: PlanDraft;
  wizard?: UserWizard;
  awaitingPromptMode?: Exclude<AgentMode, "smart">;
}

export interface SessionRecord {
  id: string;
  agentId: string;
  label: string;
  workspacePath: string;
  createdAt: string;
  lastUsedAt: string;
  lastPromptPreview?: string;
}

export interface WorkspaceEntry {
  alias: string;
  path: string;
  isDefault?: boolean;
  source: "config" | "user";
}

export interface DiscoveredSkill {
  name: string;
  description: string;
  filePath: string;
  disableModelInvocation: boolean;
  paths?: string;
}

export interface WorkspaceProfile {
  skillRoots?: string[];
  extraSkillDirs?: string[];
  defaultPinnedSkills?: string[];
  settingSources?: SettingSource[];
}

export interface WorkspacesConfig {
  defaultAlias?: string;
  /** Allowed parent directories for workspace paths */
  roots?: string[];
  aliases: Record<string, string>;
  profiles?: Record<string, WorkspaceProfile>;
}

export interface ActiveJob {
  runId?: string;
  agentId?: string;
  executor: "sdk";
  cancel?: () => Promise<void>;
}

export interface ModelParamDefinition {
  id: string;
  displayName?: string;
  values: Array<{ value: string; displayName?: string }>;
}

export interface CatalogModel {
  id: string;
  displayName: string;
  parameters: ModelParamDefinition[];
  variants?: Array<{
    params: ModelParam[];
    displayName: string;
    isDefault?: boolean;
  }>;
}
