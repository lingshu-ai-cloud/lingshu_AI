import type { BusinessMetric, DigitalEmployeeOverview } from './digitalEmployees';
import type { CustomerProfile, TimelineEvent } from '../types/customer';

export const observedMetric = (metric?: BusinessMetric): number | null =>
  metric?.status === 'available' && typeof metric.value === 'number' && Number.isFinite(metric.value) && metric.value >= 0
    ? metric.value : null;

export const beijingDay = (value: string | number | Date): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const field = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${field('year')}-${field('month')}-${field('day')}`;
};

export const realCustomers = (customers: CustomerProfile[]): CustomerProfile[] => customers.filter(customer =>
  !customer.isMock && !customer.isHistorical && customer.isReal !== false && !customer.readOnly,
);

const eventDay = (event: TimelineEvent): string => beijingDay(event.timestamp || event.time);
const sent = (event: TimelineEvent): boolean =>
  event.actor !== 'buyer' && (event.sendStatus === 'sent' || event.sendStatus === 'delivered');

export function customerOverview(customers: CustomerProfile[], today: string) {
  const rows = realCustomers(customers);
  const inbound = (customer: CustomerProfile) => customer.timeline.some(event => event.actor === 'buyer');
  const outbound = (customer: CustomerProfile) => customer.timeline.filter(sent);
  const quoted = (customer: CustomerProfile) => customer.stage === 'quoted' || customer.stage === 'won'
    || customer.timeline.some(event => event.type === 'quote' && sent(event));
  const tags = new Map<string, number>();
  for (const customer of rows) for (const raw of new Set(customer.tags.map(tag => tag.trim()).filter(Boolean))) {
    tags.set(raw, (tags.get(raw) || 0) + 1);
  }
  return {
    total: rows.length,
    lead: rows.filter(customer => customer.stage === 'lead').length,
    inbound: rows.filter(inbound).length,
    quoted: rows.filter(quoted).length,
    won: rows.filter(customer => customer.stage === 'won' || customer.orders.some(order => order.status === 'paid')).length,
    todayInbound: rows.filter(customer => customer.timeline.some(event => event.actor === 'buyer' && eventDay(event) === today)).length,
    todayOutreach: rows.filter(customer => outbound(customer).some(event => eventDay(event) === today)).length,
    funnel: [
      rows.filter(inbound).length,
      rows.filter(customer => outbound(customer).length > 0).length,
      rows.filter(customer => customer.intentSignals.length > 0 || customer.bant?.updatedAt).length,
      rows.filter(customer => customer.timeline.some(event => event.type === 'quote' && event.actor === 'ai' && sent(event))).length,
      rows.filter(customer => outbound(customer).length >= 2).length,
    ],
    tags: [...tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN')).slice(0, 8),
  };
}

export function todayOverview(data: DigitalEmployeeOverview, customers: CustomerProfile[], now = new Date()) {
  const day = beijingDay(now);
  const daily = data.businessSnapshot?.social.dailyTrend.find(item => item.date.slice(0, 10) === day);
  const customer = customerOverview(customers, day);
  return {
    day,
    views: daily?.views ?? null,
    interactions: daily?.interactions ?? null,
    inbound: customer.todayInbound,
    outreach: customer.todayOutreach,
    completed: data.businessSnapshot?.completedToday?.length ?? null,
    pending: data.businessSnapshot?.needsDecision?.length ?? null,
  };
}
