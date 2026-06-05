export interface ModelUsageSlice {
  model: string;
  cents: number;
  /** Within Auto or API category (0–100). */
  percentOfCategory: number;
}

export interface UsageSnapshot {
  source: "period" | "summary";
  billingCycleStart: Date;
  billingCycleEnd: Date;
  limitCents: number | null;
  includedSpendCents: number | null;
  remainingCents: number | null;
  bonusSpendCents: number | null;
  remainingBonus: boolean;
  autoPercentUsed: number | null;
  apiPercentUsed: number | null;
  totalPercentUsed: number | null;
  displayMessage: string | null;
  autoModelSelectedDisplayMessage: string | null;
  namedModelSelectedDisplayMessage: string | null;
  spendLimit: {
    individualRemainingCents: number | null;
    individualLimitCents: number | null;
    individualUsedCents: number | null;
  } | null;
  modelBreakdown: {
    auto: ModelUsageSlice[];
    api: ModelUsageSlice[];
    eventCount: number;
  };
}

export type UsageFetchResult =
  | { ok: true; data: UsageSnapshot }
  | { ok: false; error: string };
