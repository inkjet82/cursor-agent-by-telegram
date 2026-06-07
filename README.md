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

## Windows 상시 실행 (PM2 + bat)

Windows에서는 `pm2 startup`이 동작하지 않습니다. **bat + 시작 프로그램** 방식을 사용합니다.

1. 최초 1회: 프로젝트 폴더에서 `start-bot.bat` 더블클릭 (빌드 후 PM2 기동)
2. 재부팅 후 자동 기동: `register-windows-startup.bat` 실행 → Startup 폴더에 등록
3. 수동 재시작: `start-bot.bat` 또는 텔레그램 `/restart`
4. 중지: `stop-bot.bat`

로그: `data/pm2-out.log`, `data/pm2-error.log`, 재부팅 기동 로그 `data/startup.log`

PC 절전 시 봇이 응답하지 않습니다.

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

1. `/plan 기능 추가해줘` → Plan **초안** (실행 버튼 없음, [계획 완료]만)
2. 수정이 필요하면 같은 Plan 모드로 추가 메시지
3. `/done` 또는 **[계획 완료]** → `✅ 계획 완료` + **[실행]** 버튼
4. **실행** 또는 `/approve` → Agent가 구현
5. 기본 모드 **Agent** + 일반 텍스트 → Plan 없이 **즉시** Agent
6. `/agent` (명령) → Plan 초안 후 `/done` → 실행 (안전 모드)
7. `/agent!` 또는 `SKIP_PLAN_APPROVAL=true` → Plan 생략 즉시 Agent

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
