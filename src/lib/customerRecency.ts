import type { CustomerProfile } from '../types/customer';

function messageTimestamp(customer: CustomerProfile): number {
  const latestEvent = customer.timeline[customer.timeline.length - 1];
  if (Number.isFinite(latestEvent?.timestamp)) return latestEvent.timestamp as number;
  if (Number.isFinite(customer.lastActiveAt)) return customer.lastActiveAt as number;
  const value = String(latestEvent?.time || customer.lastActive || '').trim();
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  const clock = value.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) return new Date().setHours(Number(clock[1]), Number(clock[2]), 0, 0);
  const amount = Number(value.match(/\d+/)?.[0] || 0);
  if (/分钟前|min/i.test(value)) return Date.now() - amount * 60_000;
  if (/小时前|hour|\bh\b/i.test(value)) return Date.now() - amount * 3_600_000;
  if (/天前|day|\bd\b/i.test(value)) return Date.now() - amount * 86_400_000;
  // “刚刚” is a display label, not sortable data. Mapping it to Date.now()
  // on every render makes an old conversation permanently float to the top.
  return 0;
}

export function sortCustomersByLatestMessage<T extends CustomerProfile>(customers: T[]): T[] {
  return [...customers].sort((a, b) => messageTimestamp(b) - messageTimestamp(a));
}
