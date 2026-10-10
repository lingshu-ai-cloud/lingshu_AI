export type AccountProviderName = 'codex' | 'claude';

export type AccountAuthState =
  | 'authenticated'
  | 'unauthenticated'
  | 'needs_reauth'
  | 'unavailable'
  | 'unknown';

export interface AccountProviderStatus {
  provider: AccountProviderName;
  state: AccountAuthState;
  cliAvailable: boolean;
  account?: {
    email?: string;
    plan?: string;
    authMode?: string;
  };
  reason?: string;
}

export interface AccountUsageWindow {
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins: number | null;
  resetsAt: string | null;
}

export interface AccountRateLimit {
  id: string;
  name: string | null;
  planType: string | null;
  primary: AccountUsageWindow | null;
  secondary: AccountUsageWindow | null;
  reachedType: string | null;
}

export interface AccountTokenUsage {
  lifetimeTokens: number | null;
  peakDailyTokens: number | null;
  longestRunningTurnSec: number | null;
  currentStreakDays: number | null;
  longestStreakDays: number | null;
  daily: Array<{ startDate: string; tokens: number }>;
}

export interface AccountProviderUsage {
  provider: AccountProviderName;
  available: boolean;
  fetchedAt: string;
  limits: AccountRateLimit[];
  creditsRemaining: number | null;
  resetCreditsAvailable: number | null;
  tokenUsage: AccountTokenUsage | null;
  reason?: 'provider_not_supported' | 'usage_unavailable' | 'authentication_required';
}

export class AccountProviderError extends Error {
  constructor(
    readonly code:
      | 'invalid_input'
      | 'cli_unavailable'
      | 'protocol_error'
      | 'timeout'
      | 'cancelled'
      | 'operation_failed',
    message: string,
  ) {
    super(message);
    this.name = 'AccountProviderError';
  }
}
