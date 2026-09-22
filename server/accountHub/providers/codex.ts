import type {
  AccountProviderStatus,
  AccountProviderUsage,
  AccountRateLimit,
  AccountTokenUsage,
} from './types.js';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function textField(source: UnknownRecord | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function nestedRecord(source: UnknownRecord | undefined, ...keys: string[]): UnknownRecord | undefined {
  for (const key of keys) {
    const value = record(source?.[key]);
    if (value) return value;
  }
  return undefined;
}

/** Selects credential-free account metadata from an official app-server response. */
export function publicStatusFromAccount(result: unknown): AccountProviderStatus {
  const root = record(result);
  const container = nestedRecord(root, 'data') ?? root;
  const account = record(container?.account);
  if (!account) return { provider: 'codex', state: 'unauthenticated', cliAvailable: true };
  return {
    provider: 'codex',
    state: 'authenticated',
    cliAvailable: true,
    account: {
      email: textField(account, 'email', 'userEmail'),
      plan: textField(account, 'planType', 'plan', 'subscriptionType'),
      authMode: textField(account, 'type', 'authMode'),
    },
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function unixTime(value: unknown): string | null {
  const seconds = finiteNumber(value);
  if (seconds === null || seconds < 0) return null;
  const date = new Date(seconds * 1_000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function usageWindow(value: unknown) {
  const source = record(value);
  const usedPercent = finiteNumber(source?.usedPercent ?? source?.used_percent);
  if (usedPercent === null) return null;
  const bounded = Math.max(0, Math.min(100, usedPercent));
  return {
    usedPercent: bounded,
    remainingPercent: Math.max(0, 100 - bounded),
    windowDurationMins: finiteNumber(source?.windowDurationMins ?? source?.window_duration_mins),
    resetsAt: unixTime(source?.resetsAt ?? source?.resets_at),
  };
}

function rateLimit(value: unknown, fallbackId: string): AccountRateLimit | null {
  const source = record(value);
  if (!source) return null;
  const primary = usageWindow(source.primary);
  const secondary = usageWindow(source.secondary);
  if (!primary && !secondary) return null;
  return {
    id: textField(source, 'limitId', 'limit_id') ?? fallbackId,
    name: textField(source, 'limitName', 'limit_name') ?? null,
    planType: textField(source, 'planType', 'plan_type') ?? null,
    primary,
    secondary,
    reachedType: textField(source, 'rateLimitReachedType', 'rate_limit_reached_type') ?? null,
  };
}

function rateLimitsFromResult(result: unknown): {
  limits: AccountRateLimit[];
  creditsRemaining: number | null;
  resetCreditsAvailable: number | null;
} {
  const root = record(result);
  const source = nestedRecord(root, 'data') ?? root;
  const byId = record(source?.rateLimitsByLimitId ?? source?.rate_limits_by_limit_id);
  const limits = byId
    ? Object.entries(byId).flatMap(([id, value]) => {
      const parsed = rateLimit(value, id);
      return parsed ? [parsed] : [];
    })
    : [];
  if (limits.length === 0) {
    const legacy = rateLimit(source?.rateLimits ?? source?.rate_limits, 'codex');
    if (legacy) limits.push(legacy);
  }
  const reset = record(source?.rateLimitResetCredits ?? source?.rate_limit_reset_credits);
  const credits = source?.credits;
  const creditRecord = record(credits);
  return {
    limits,
    creditsRemaining: finiteNumber(credits) ?? finiteNumber(creditRecord?.remaining ?? creditRecord?.balance),
    resetCreditsAvailable: finiteNumber(reset?.availableCount ?? reset?.available_count),
  };
}

function tokenUsageFromResult(result: unknown): AccountTokenUsage | null {
  const root = record(result);
  const source = nestedRecord(root, 'data') ?? root;
  const summary = record(source?.summary);
  const buckets = source?.dailyUsageBuckets ?? source?.daily_usage_buckets;
  if (!summary && !Array.isArray(buckets)) return null;
  const daily = Array.isArray(buckets)
    ? buckets.flatMap(value => {
      const item = record(value);
      const startDate = textField(item, 'startDate', 'start_date');
      const tokens = finiteNumber(item?.tokens);
      return startDate && tokens !== null ? [{ startDate, tokens }] : [];
    })
    : [];
  return {
    lifetimeTokens: finiteNumber(summary?.lifetimeTokens ?? summary?.lifetime_tokens),
    peakDailyTokens: finiteNumber(summary?.peakDailyTokens ?? summary?.peak_daily_tokens),
    longestRunningTurnSec: finiteNumber(summary?.longestRunningTurnSec ?? summary?.longest_running_turn_sec),
    currentStreakDays: finiteNumber(summary?.currentStreakDays ?? summary?.current_streak_days),
    longestStreakDays: finiteNumber(summary?.longestStreakDays ?? summary?.longest_streak_days),
    daily,
  };
}

/** Normalizes only usage counters. It never reads or mutates Provider credentials. */
export function normalizeCodexUsage(rateLimitsResult: unknown, usageResult: unknown): AccountProviderUsage {
  const rate = rateLimitsFromResult(rateLimitsResult);
  const tokenUsage = tokenUsageFromResult(usageResult);
  const available = rate.limits.length > 0 || tokenUsage !== null || rate.creditsRemaining !== null;
  return {
    provider: 'codex',
    available,
    fetchedAt: new Date().toISOString(),
    ...rate,
    tokenUsage,
    ...(available ? {} : { reason: 'usage_unavailable' as const }),
  };
}
