/**
 * Spread one account's own publishing slots across the whole operating week.
 * Every account starts from the same weekly axis, so several accounts can run
 * in parallel instead of one account exhausting all of its posts first.
 */
export function publishDateForAccountSlot(startsAt: string, endsAt: string, slotIndex: number, accountTotal: number): string {
  const start = Date.parse(`${startsAt}T00:00:00Z`);
  const end = Date.parse(`${endsAt}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  const days = Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
  const total = Math.max(1, Math.floor(accountTotal) || 1);
  const index = Math.max(0, Math.min(total - 1, Math.floor(slotIndex) || 0));
  const offset = total === 1
    ? Math.floor((days - 1) / 2)
    : Math.round(index * (days - 1) / (total - 1));
  return new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
}

