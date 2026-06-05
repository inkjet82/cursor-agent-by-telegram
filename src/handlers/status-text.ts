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

• 그냥 메시지 → 기본 모드(초기 Ask)로 실행
• /plan → Plan (CLI, 읽기 전용) + [실행][취소] 버튼
• /ask → Ask (CLI, 읽기 전용)
• /agent → 기본 Plan 확인 후 실행 (SKIP_PLAN_APPROVAL=true 면 즉시)
• /agent! 또는 /agent --force → Plan 생략 즉시 Agent
• /approve → 마지막 Plan 승인 후 Agent 실행

하단 버튼: Ask, Plan, Agent, 세션, 워크스페이스, 스킬, 설정…

워크스페이스: /workspaces 또는 하단 「워크스페이스」 버튼 · /workspace C:\\path

스킬: /skills — 매번 새로 ☑ 선택 → [적용] 또는 바로 질문 (다음 1회만, 여러 개 가능).

/cancel — 진행 중 작업 취소
/new — 새 세션
/models — agent CLI 모델 목록
/usage — Cursor 포함 사용량·모델별 통계 (CURSOR_SESSION_TOKEN)
/restart — 빌드 성공 후 PM2 재시작 (기동 시 텔레그램 알림)`;
}
