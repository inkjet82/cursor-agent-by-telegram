import { aggregateModelUsage } from "./model-classify.js";
import { cookieOnlyHeaders, sessionAuthHeaders } from "./auth.js";
import type { UsageSnapshot } from "./types.js";

const API2_BASE = "https://api2.cursor.sh";
const CURSOR_WEB = "https://cursor.com";

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}

function parseMsDate(v: unknown): Date | null {
  const n = num(v);
  if (n == null) return null;
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseIsoDate(v: unknown): Date | null {
  if (typeof v !== "string") return parseMsDate(v);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`응답 JSON 파싱 실패 (${res.status})`);
  }
}

function unwrapBody(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  const o = data as Record<string, unknown>;
  if (o.planUsage && typeof o.planUsage === "object") return o;
  if (o.data && typeof o.data === "object") {
    return o.data as Record<string, unknown>;
  }
  return o;
}

export async function fetchCurrentPeriodUsage(
  sessionToken: string,
  apiBase = API2_BASE,
): Promise<Record<string, unknown>> {
  const url = `${apiBase.replace(/\/$/, "")}/aiserver.v1.DashboardService/GetCurrentPeriodUsage`;
  const res = await fetch(url, {
    method: "POST",
    headers: sessionAuthHeaders(sessionToken),
    body: "{}",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GetCurrentPeriodUsage ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
  }
  return unwrapBody(await readJson(res));
}

export async function fetchUsageSummary(
  sessionToken: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${CURSOR_WEB}/api/usage-summary`, {
    method: "GET",
    headers: cookieOnlyHeaders(sessionToken),
  });
  if (!res.ok) {
    throw new Error(`usage-summary ${res.status}`);
  }
  return (await readJson(res)) as Record<string, unknown>;
}

interface RawUsageEvent {
  model: string;
  chargedCents: number;
}

export async function fetchUsageEvents(
  sessionToken: string,
  startMs: number,
  endMs: number,
  pageSize = 200,
): Promise<RawUsageEvent[]> {
  const res = await fetch(
    `${CURSOR_WEB}/api/dashboard/get-filtered-usage-events`,
    {
      method: "POST",
      headers: cookieOnlyHeaders(sessionToken),
      body: JSON.stringify({
        startDate: String(startMs),
        endDate: String(endMs),
        page: 1,
        pageSize,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`usage-events ${res.status}`);
  }
  const data = (await readJson(res)) as Record<string, unknown>;
  const list = data.usageEventsDisplay;
  if (!Array.isArray(list)) return [];
  const out: RawUsageEvent[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const model = typeof e.model === "string" ? e.model : "unknown";
    const charged = num(e.chargedCents) ?? 0;
    out.push({ model, chargedCents: charged });
  }
  return out;
}

function snapshotFromPeriod(
  body: Record<string, unknown>,
  modelBreakdown: UsageSnapshot["modelBreakdown"],
): UsageSnapshot {
  const plan = (body.planUsage ?? {}) as Record<string, unknown>;
  const spend = body.spendLimitUsage as Record<string, unknown> | undefined;

  const start =
    parseMsDate(body.billingCycleStart) ?? new Date();
  const end = parseMsDate(body.billingCycleEnd) ?? new Date();

  let spendLimit: UsageSnapshot["spendLimit"] = null;
  if (spend && typeof spend === "object") {
    spendLimit = {
      individualRemainingCents: num(spend.individualRemaining),
      individualLimitCents: num(spend.individualLimit),
      individualUsedCents: num(spend.individualUsed),
    };
  }

  return {
    source: "period",
    billingCycleStart: start,
    billingCycleEnd: end,
    limitCents: num(plan.limit),
    includedSpendCents: num(plan.includedSpend) ?? num(plan.totalSpend),
    remainingCents: num(plan.remaining),
    bonusSpendCents: num(plan.bonusSpend),
    remainingBonus: plan.remainingBonus === true,
    autoPercentUsed: num(plan.autoPercentUsed),
    apiPercentUsed: num(plan.apiPercentUsed),
    totalPercentUsed: num(plan.totalPercentUsed),
    displayMessage:
      typeof body.displayMessage === "string" ? body.displayMessage : null,
    autoModelSelectedDisplayMessage:
      typeof body.autoModelSelectedDisplayMessage === "string"
        ? body.autoModelSelectedDisplayMessage
        : null,
    namedModelSelectedDisplayMessage:
      typeof body.namedModelSelectedDisplayMessage === "string"
        ? body.namedModelSelectedDisplayMessage
        : null,
    spendLimit,
    modelBreakdown,
  };
}

function snapshotFromSummary(
  body: Record<string, unknown>,
  modelBreakdown: UsageSnapshot["modelBreakdown"],
): UsageSnapshot {
  const start = parseIsoDate(body.billingCycleStart) ?? new Date();
  const end = parseIsoDate(body.billingCycleEnd) ?? new Date();
  const ind = (body.individualUsage ?? {}) as Record<string, unknown>;
  const plan = (ind.plan ?? {}) as Record<string, unknown>;

  return {
    source: "summary",
    billingCycleStart: start,
    billingCycleEnd: end,
    limitCents: num(plan.limit),
    includedSpendCents: num(plan.used),
    remainingCents: num(plan.remaining),
    bonusSpendCents: num((plan.breakdown as Record<string, unknown>)?.bonus),
    remainingBonus: false,
    autoPercentUsed: num(plan.autoPercentUsed),
    apiPercentUsed: num(plan.apiPercentUsed),
    totalPercentUsed: num(plan.totalPercentUsed),
    displayMessage:
      typeof body.namedModelSelectedDisplayMessage === "string"
        ? body.namedModelSelectedDisplayMessage
        : typeof body.autoModelSelectedDisplayMessage === "string"
          ? body.autoModelSelectedDisplayMessage
          : null,
    autoModelSelectedDisplayMessage:
      typeof body.autoModelSelectedDisplayMessage === "string"
        ? body.autoModelSelectedDisplayMessage
        : null,
    namedModelSelectedDisplayMessage:
      typeof body.namedModelSelectedDisplayMessage === "string"
        ? body.namedModelSelectedDisplayMessage
        : null,
    spendLimit: null,
    modelBreakdown,
  };
}

export async function loadUsageSnapshot(
  sessionToken: string,
  apiBase?: string,
): Promise<UsageSnapshot> {
  let periodBody: Record<string, unknown> | null = null;
  try {
    periodBody = await fetchCurrentPeriodUsage(sessionToken, apiBase);
  } catch {
    periodBody = null;
  }

  const start =
    (periodBody && parseMsDate(periodBody.billingCycleStart)) ??
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end =
    (periodBody && parseMsDate(periodBody.billingCycleEnd)) ?? new Date();

  let events: RawUsageEvent[] = [];
  try {
    events = await fetchUsageEvents(
      sessionToken,
      start.getTime(),
      end.getTime(),
    );
  } catch {
    events = [];
  }

  const { auto, api } = aggregateModelUsage(events);
  const modelBreakdown = {
    auto,
    api,
    eventCount: events.length,
  };

  if (periodBody?.planUsage) {
    return snapshotFromPeriod(periodBody, modelBreakdown);
  }

  const summary = await fetchUsageSummary(sessionToken);
  return snapshotFromSummary(summary, modelBreakdown);
}
