import { metaDateRange } from './metaPerformance.js';

/** Presets or one explicit account-local calendar date. */
export type AdReportPeriod = 7 | 30 | string;
export function parseAdReportPeriod(query: Record<string, unknown>): AdReportPeriod {
  const keys = Object.keys(query);
  if (keys.some(key => key !== 'days' && key !== 'date') || query.days !== undefined && query.date !== undefined) throw new Error('INVALID_REPORT_PERIOD');
  if (query.date !== undefined) {
    if (typeof query.date !== 'string' || !metaDateRange(query.date, query.date).length) throw new Error('INVALID_REPORT_PERIOD');
    return query.date;
  }
  if (query.days === undefined) return 7;
  if (typeof query.days !== 'string' || !['7', '30'].includes(query.days)) throw new Error('INVALID_REPORT_PERIOD');
  return Number(query.days) as 7 | 30;
}
export function resolveAdReportWindow(period: AdReportPeriod, today: string) {
  if (!metaDateRange(today, today).length) throw new Error('INVALID_REPORT_PERIOD');
  if (typeof period === 'string') {
    if (!metaDateRange(period, period).length || period > today) throw new Error('INVALID_REPORT_PERIOD');
    return { since: period, until: period };
  }
  if (period !== 7 && period !== 30) throw new Error('INVALID_REPORT_PERIOD');
  return { since: new Date(Date.parse(`${today}T12:00:00Z`) - (period - 1) * 86400000).toISOString().slice(0, 10), until: today };
}
export function adReportPeriodQuery(period: AdReportPeriod) {
  return typeof period === 'string' ? `date=${encodeURIComponent(period)}` : `days=${period}`;
}
