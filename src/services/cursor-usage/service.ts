import type { Env } from "../../env.js";
import { loadUsageSnapshot } from "./fetch.js";
import { formatUsageFull, formatUsageStatusLine } from "./format.js";
import type { UsageFetchResult, UsageSnapshot } from "./types.js";

const CACHE_MS = 90_000;

export class CursorUsageService {
  private cache: { at: number; result: UsageFetchResult } | null = null;

  constructor(private env: Env) {}

  isConfigured(): boolean {
    return Boolean(this.env.CURSOR_SESSION_TOKEN?.trim());
  }

  async fetch(force = false): Promise<UsageFetchResult> {
    const token = this.env.CURSOR_SESSION_TOKEN?.trim();
    if (!token) {
      return {
        ok: false,
        error: "CURSOR_SESSION_TOKEN 이 .env 에 없습니다.",
      };
    }

    if (
      !force &&
      this.cache &&
      Date.now() - this.cache.at < CACHE_MS
    ) {
      return this.cache.result;
    }

    try {
      const data = await loadUsageSnapshot(
        token,
        this.env.CURSOR_USAGE_API_BASE,
      );
      const result: UsageFetchResult = { ok: true, data };
      this.cache = { at: Date.now(), result };
      return result;
    } catch (e) {
      const result: UsageFetchResult = {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
      this.cache = { at: Date.now(), result };
      return result;
    }
  }

  async getStatusLine(force = false): Promise<string | undefined> {
    if (!this.isConfigured()) return undefined;
    const r = await this.fetch(force);
    if (!r.ok) return `💳 사용량: 조회 실패 (${r.error})`;
    return formatUsageStatusLine(r.data);
  }

  async getFullMessage(force = false): Promise<string> {
    if (!this.isConfigured()) {
      return [
        "📊 Cursor 사용량",
        "",
        "CURSOR_SESSION_TOKEN 이 설정되지 않았습니다.",
        "",
        "1. cursor.com 로그인 → F12 → Cookies → WorkosCursorSessionToken 복사",
        "2. .env 에 CURSOR_SESSION_TOKEN=... 추가",
        "3. 봇 재시작",
      ].join("\n");
    }
    const r = await this.fetch(force);
    if (!r.ok) {
      return [
        "📊 Cursor 사용량",
        "",
        `❌ 조회 실패: ${r.error}`,
        "",
        "토큰 만료 시 쿠키를 다시 복사하세요.",
      ].join("\n");
    }
    return formatUsageFull(r.data);
  }
}

export type { UsageSnapshot };
