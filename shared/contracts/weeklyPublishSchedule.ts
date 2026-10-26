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
export const DEFAULT_VIDEO_PUBLISH_TIMES = ['09:00', '16:00', '18:00'] as const;

function beijingSlot(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T`;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Next unoccupied default Beijing slot; confirmed custom times are not changed. */
export function nextDefaultVideoPublishTime(now: Date, occupied: string[]): string {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  const localDay = `${parts.year}-${parts.month}-${parts.day}`;
  const occupiedInstants = new Set(occupied.map(value => Date.parse(value)).filter(Number.isFinite));
  const start = Date.parse(`${localDay}T00:00:00Z`);
  for (let offset = 0; offset < 366; offset += 1) {
    const date = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
    for (const time of DEFAULT_VIDEO_PUBLISH_TIMES) {
      const instant = Date.parse(`${date}T${time}:00+08:00`);
      if (instant > now.getTime() && !occupiedInstants.has(instant)) return `${date}T${time}`;
    }
  }
  throw new Error('未来一年内没有可用的默认发布时间');
}

/**
 * Spread the complete weekly output, not each account in isolation. Accounts
 * are round-robined before dates are assigned, so singleton accounts no longer
 * collapse onto the same middle day. Times are explicit Beijing instants.
 */
export function balancedWeeklyPublishSlots(
  startsAt: string,
  endsAt: string,
  groupKeys: string[],
  localTime?: string,
  reservedByIndex: Array<string | undefined> = [],
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
  reservedByIndex.forEach((value, index) => {
    if (!value || !groupKeys[index]) return;
    const date = beijingSlot(value).slice(0, 10);
    const offset = Math.round((Date.parse(`${date}T00:00:00Z`) - start) / 86_400_000);
    if (offset < 0 || offset >= days) return;
    const key = groupKeys[index]!;
    usedOffsets.set(key, new Set([...(usedOffsets.get(key) || []), offset]));
  });
  const usedTimesByDate = new Map<string, Set<string>>();
  for (const value of reservedByIndex) {
    if (!value) continue;
    const slot = beijingSlot(value);
    if (!slot) continue;
    const day = slot.slice(0, 10), time = slot.slice(11);
    if (!time) continue;
    usedTimesByDate.set(day, new Set([...(usedTimesByDate.get(day) || []), time]));
  }
  const dateAt = (offset: number) => new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
  const freeTime = (offset: number) => DEFAULT_VIDEO_PUBLISH_TIMES.find(time => !usedTimesByDate.get(dateAt(offset))?.has(time));
  order.forEach((originalIndex, position) => {
    const groupKey = groupKeys[originalIndex]!;
    const groupUsed = usedOffsets.get(groupKey) || new Set<number>();
    const confirmed = reservedByIndex[originalIndex];
    if (confirmed) {
      const date = beijingSlot(confirmed).slice(0, 10);
      result[originalIndex] = { date, scheduledAt: confirmed };
      return;
    }
    const desiredOffset = order.length === 1
      ? Math.min(1, days - 1)
      : Math.min(days - 1, Math.floor((position + 0.5) * days / order.length));
    const candidates = [desiredOffset];
    for (let distance = 1; distance < days; distance += 1) {
      if (desiredOffset + distance < days) candidates.push(desiredOffset + distance);
      if (desiredOffset - distance >= 0) candidates.push(desiredOffset - distance);
    }
    const offset = candidates.find(day => !groupUsed.has(day) && (localTime || freeTime(day)))
      ?? candidates.find(day => localTime || freeTime(day));
    if (offset === undefined) {
      result[originalIndex] = { date: '', scheduledAt: '' };
      return;
    }
    groupUsed.add(offset);
    usedOffsets.set(groupKey, groupUsed);
    const date = dateAt(offset), time = localTime || freeTime(offset);
    if (!time) { result[originalIndex] = { date: '', scheduledAt: '' }; return; }
    usedTimesByDate.set(date, new Set([...(usedTimesByDate.get(date) || []), time]));
    result[originalIndex] = { date, scheduledAt: `${date}T${time}:00+08:00` };
  });
  return result;
}

