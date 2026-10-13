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

export type WeeklyPublishSlot = { date: string; scheduledAt: string };

/**
 * Spread the complete weekly output, not each account in isolation. Accounts
 * are round-robined before dates are assigned, so singleton accounts no longer
 * collapse onto the same middle day. Times are explicit Beijing instants.
 */
export function balancedWeeklyPublishSlots(
  startsAt: string,
  endsAt: string,
  groupKeys: string[],
  localTime = '18:00',
): WeeklyPublishSlot[] {
  const start = Date.parse(`${startsAt}T00:00:00Z`);
  const end = Date.parse(`${endsAt}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || !groupKeys.length) return [];
  const days = Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
  const groups = new Map<string, number[]>();
  groupKeys.forEach((key, index) => groups.set(key, [...(groups.get(key) || []), index]));
  const order: number[] = [];
  const maxGroupSize = Math.max(...[...groups.values()].map(indices => indices.length));
  for (let position = 0; position < maxGroupSize; position += 1) {
    for (const indices of groups.values()) if (indices[position] !== undefined) order.push(indices[position]!);
  }
  const result: WeeklyPublishSlot[] = Array.from({ length: groupKeys.length });
  const usedOffsets = new Map<string, Set<number>>();
  order.forEach((originalIndex, position) => {
    const groupKey = groupKeys[originalIndex]!;
    const groupUsed = usedOffsets.get(groupKey) || new Set<number>();
    const desiredOffset = order.length === 1
      ? Math.min(1, days - 1)
      : Math.min(days - 1, Math.floor((position + 0.5) * days / order.length));
    let offset = desiredOffset;
    if (groupUsed.has(offset) && groupUsed.size < days) {
      for (let distance = 1; distance < days; distance += 1) {
        const later = desiredOffset + distance;
        const earlier = desiredOffset - distance;
        if (later < days && !groupUsed.has(later)) {
          offset = later;
          break;
        }
        if (earlier >= 0 && !groupUsed.has(earlier)) {
          offset = earlier;
          break;
        }
      }
    }
    groupUsed.add(offset);
    usedOffsets.set(groupKey, groupUsed);
    const date = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
    result[originalIndex] = { date, scheduledAt: `${date}T${localTime}:00+08:00` };
  });
  return result;
}

