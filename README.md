# cursor-agent-by-telegram

텔레그램에서 로컬 PC의 Cursor Agent를 원격으로 실행하는 봇입니다.

- **Plan / Ask / Agent** — `@cursor/sdk` 로컬 런타임
- **워크스페이스** — 프로젝트 경로 지정·전환 (`config/workspaces.json` + 텔레그램 UI)

## 요구 사항

- Node.js 20+
- [Cursor API Key](https://cursor.com/dashboard/cloud-agents) (`CURSOR_API_KEY`)
- Telegram Bot Token ([@BotFather](https://t.me/BotFather))

## 설정

1. `.env.example`을 `.env`로 복사합니다.

```bash
cp .env.example .env
```

2. 변수를 채웁니다.

| 변수 | 설명 |
|------|------|
| `TELEGRAM_BOT_TOKEN` | BotFather 토큰 |
| `TELEGRAM_CHAT_ID` | 허용할 채팅 ID (본인만) |
| `CURSOR_API_KEY` | Cursor API 키 |
| `SKIP_PLAN_APPROVAL` | `true`면 `/agent`가 Plan 없이 즉시 실행 |
| `DEFAULT_MODEL_ID` | 기본 모델 (예: `composer-2.5`) |
| `DEFAULT_MODE` | 기본 모드 `ask` / `plan` / `agent` / `smart` |

3. **워크스페이스** — [config/workspaces.json](config/workspaces.json)

   - `roots`: 허용 상위 경로 (보안)
   - `aliases`: 별칭 → 절대 경로
   - 텔레그램: **워크스페이스** 버튼 또는 `/workspaces`

## 실행

```bash
npm install
npm run dev
```

프로덕션:

```bash
npm run build
npm start
```

## Windows 상시 실행 (PM2)

```bash
npm install -g pm2
npm run pm2:start
pm2 save
```

또는 작업 스케줄러로 로그온 시 `npm start` 실행. PC 절전 시 봇이 응답하지 않습니다.

## 사용 요약

| 동작 | 방법 |
|------|------|
| 질문 (Ask) | `/ask` 또는 Ask 버튼 |
| Plan + 승인 | `/plan` → [실행] 또는 `/approve` |
| Agent (Plan 후) | `/agent` (기본) |
| Agent 즉시 | `/agent!` 또는 `/agent --force` |
| 워크스페이스 | `/workspaces`, `/workspace C:\path` |
| 모델 목록 | `/models` |
| 취소 | `/cancel` |
| 상태 | `/status` |

### Plan → Agent 흐름

1. `/plan 기능 추가해줘` → Plan 결과 + [실행][취소] 버튼
2. **실행** 또는 `/approve` → Agent가 구현
3. `SKIP_PLAN_APPROVAL=true` 이면 `/agent`가 1단계 생략

### 스킬

- 워크스페이스 루트의 `.cursor/skills`, `.agents/skills` 검색
- **스킬** 메뉴에서 ☑ 고정 또는 1회 적용

## 아키텍처

```
Telegram → grammY (polling) → JobQueue → CursorSdkRunner (@cursor/sdk)
```

## 데이터 (gitignore)

- `data/state.json` — 사용자 설정
- `data/sessions.json` — SDK 세션
- `data/workspaces.user.json` — 텔레그램에서 추가한 워크스페이스

## 보안

- `TELEGRAM_CHAT_ID` allowlist 외 채팅은 무시
- `config/workspaces.json`의 `roots` 밖 경로 거부
- Agent 모드는 로컬 파일·셸 변경 가능 — Plan 승인 또는 `/agent!` 사용 권장
- `.env`를 git에 커밋하지 마세요
