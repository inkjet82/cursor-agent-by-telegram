import type { UserState } from "../types.js";
import type { ModelEnvConfig } from "../config/model-env.js";
import { formatParamsLine, paramsForModel } from "../config/model-env.js";

export function formatStatus(
  state: UserState,
  modelConfig: ModelEnvConfig,
  sessionLabel?: string,
  busy?: boolean,
  usageLine?: string,
): string {
  const envParams = paramsForModel(modelConfig, state.modelId);
  const paramLine = modelConfig.paramsLock
    ? formatParamsLine(envParams)
    : state.modelParams.length
      ? formatParamsLine(state.modelParams)
      : formatParamsLine(envParams);

  const lines = [
    "📊 상태",
    `모드(기본): ${state.defaultMode}`,
    `워크스페이스: ${state.workspaceAlias ?? "(미등록)"}`,
    `실행 경로(cwd): ${state.workspacePath}`,
    `모델: ${state.modelId} (${paramLine})`,
    `Force: ${state.force ? "ON" : "OFF"}`,
    `다음 메시지 스킬: ${state.pendingSkillNames.length ? state.pendingSkillNames.join(", ") : "(없음)"}`,
    `스킬 로딩: ${state.skillSettingSources.join(", ")}`,
    `세션: ${sessionLabel ?? "(없음)"}`,
    `작업: ${busy ? "진행 중" : "대기"}`,
  ];
  if (usageLine) lines.push(usageLine);
  return lines.join("\n");
}

export function formatHelp(): string {
  return `📖 Cursor Telegram Bot

• 기본 모드 Agent + 일반 메시지 → Plan 없이 즉시 Agent
• /plan → Plan 초안 (실행 버튼 없음) · 수정 후 /done
• /done → Plan 완료 → [실행] 버튼
• /ask → Ask (읽기 전용)
• /agent → Plan 초안 후 /done → 실행 (안전)
• /agent! 또는 /agent --force → Plan 생략 즉시 Agent
• /approve → [실행] 대기 중이면 Agent 실행 · 초안만 있으면 /done 과 동일

하단 버튼: Ask, Plan, Agent, 세션, 워크스페이스, 스킬, 설정…

/cancel — Plan 초안·승인 대기·진행 중 작업 취소
/new — 새 세션
/models — agent CLI 모델 목록
/usage — Cursor 포함 사용량·모델별 통계 (CURSOR_SESSION_TOKEN)
/restart — 빌드 (실패 시 자동 수정 최대 2회) 후 PM2 재시작`;
}
