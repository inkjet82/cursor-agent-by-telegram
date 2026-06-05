import { shortenModelName } from "./model-classify.js";
import type { ModelUsageSlice, UsageSnapshot } from "./types.js";

export function formatCents(cents: number | null): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatPercent(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const rounded = Math.round(v * 10) / 10;
  return `${rounded}%`;
}

export function formatDateShort(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** One line for /status */
export function formatUsageStatusLine(s: UsageSnapshot): string {
  const remaining = formatCents(s.remainingCents);
  const auto = formatPercent(s.autoPercentUsed);
  const api = formatPercent(s.apiPercentUsed);
  const total = formatPercent(s.totalPercentUsed);
  return `💳 사용량: ${remaining} 남음 · API ${api} · Auto ${auto} · 전체 ${total}`;
}

function formatModelLines(
  label: string,
  categoryPercent: number | null,
  slices: ModelUsageSlice[],
): string[] {
  const lines: string[] = [];
  const pct = formatPercent(categoryPercent);
  lines.push(`📈 ${label} (플랜 ${pct})`);
  if (slices.length === 0) {
    lines.push("   (이번 주기 과금 이벤트 없음 — composer·claude 등)");
    return lines;
  }
  for (const sl of slices) {
    const name = shortenModelName(sl.model);
    lines.push(
      `   · ${name}: ${formatPercent(sl.percentOfCategory)} · ${formatCents(sl.cents)}`,
    );
  }
  return lines;
}

/** Full message for /usage */
export function formatUsageFull(s: UsageSnapshot): string {
  const lines: string[] = ["📊 Cursor 사용량", ""];

  lines.push(
    `📅 주기: ${formatDateShort(s.billingCycleStart)} ~ ${formatDateShort(s.billingCycleEnd)}`,
  );
  lines.push("");

  lines.push("💰 포함 한도 (이번 주기)");
  lines.push(`   한도:  ${formatCents(s.limitCents)}`);
  lines.push(`   사용:  ${formatCents(s.includedSpendCents)}`);
  lines.push(`   남음:  ${formatCents(s.remainingCents)}`);
  if (s.bonusSpendCents != null && s.bonusSpendCents > 0) {
    lines.push(`   보너스 사용: ${formatCents(s.bonusSpendCents)}`);
  }
  if (s.remainingBonus) {
    lines.push("   🎁 보너스 크레딧 남음");
  }
  lines.push("");

  lines.push("📈 사용률 (플랜 기준)");
  lines.push(`   Auto (Composer):  ${formatPercent(s.autoPercentUsed)}`);
  lines.push(`   API (지정 모델):  ${formatPercent(s.apiPercentUsed)}`);
  lines.push(`   전체:             ${formatPercent(s.totalPercentUsed)}`);
  lines.push("");

  lines.push(
    ...formatModelLines("Auto — 모델별 (비용 비중)", s.autoPercentUsed, s.modelBreakdown.auto),
  );
  lines.push("");
  lines.push(
    ...formatModelLines("API — 모델별 (비용 비중)", s.apiPercentUsed, s.modelBreakdown.api),
  );
  if (s.modelBreakdown.eventCount > 0) {
    lines.push(
      "",
      `ℹ️ 모델별: 최근 ${s.modelBreakdown.eventCount}건 과금 이벤트 집계 (composer→Auto, 그 외→API)`,
    );
  }
  lines.push("");

  if (
    s.displayMessage ||
    s.autoModelSelectedDisplayMessage ||
    s.namedModelSelectedDisplayMessage
  ) {
    lines.push("💬 Cursor 안내");
    if (s.displayMessage) lines.push(`   ${s.displayMessage}`);
    if (s.autoModelSelectedDisplayMessage) {
      lines.push(`   Auto: ${s.autoModelSelectedDisplayMessage}`);
    }
    if (s.namedModelSelectedDisplayMessage) {
      lines.push(`   API:  ${s.namedModelSelectedDisplayMessage}`);
    }
    lines.push("");
  }

  if (s.spendLimit?.individualLimitCents != null) {
    lines.push("💳 On-demand");
    lines.push(`   사용: ${formatCents(s.spendLimit.individualUsedCents)}`);
    lines.push(`   한도: ${formatCents(s.spendLimit.individualLimitCents)}`);
    lines.push(`   남음: ${formatCents(s.spendLimit.individualRemainingCents)}`);
  }

  lines.push("");
  lines.push(formatUsageStatusLine(s));

  return lines.join("\n").trim();
}
