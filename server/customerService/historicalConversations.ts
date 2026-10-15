import fs from 'node:fs';
import path from 'node:path';

const DATA_FILE = process.env.HISTORICAL_CUSTOMERS_DATA_FILE
  ? path.resolve(process.env.HISTORICAL_CUSTOMERS_DATA_FILE)
  : path.resolve(process.cwd(), 'data/historical-customer-conversations.json');

type HistoricalCustomer = Record<string, unknown> & {
  id: string;
  tenantId: string;
  timeline: Array<Record<string, unknown>>;
};

export function readHistoricalCustomers(tenantId: string, dataFile = DATA_FILE): HistoricalCustomer[] {
  if (!tenantId.trim()) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('historical_customer_store_invalid');
    return parsed
      .filter((item): item is HistoricalCustomer => Boolean(item && typeof item === 'object'
        && String(item.tenantId || '') === tenantId
        && typeof item.id === 'string' && item.id.startsWith('history_')
        && Array.isArray(item.timeline)))
      .map(item => ({
        ...item,
        timeline: item.timeline.map(event => {
          const time = String(event.time || '');
          return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(time)
            ? { ...event, originalTime: time, time: `${time.slice(5, 10)} ${time.slice(11, 16)}` }
            : event;
        }),
        intentSignals: Array.isArray(item.intentSignals) ? item.intentSignals : [],
        orders: Array.isArray(item.orders) ? item.orders : [],
        tags: Array.isArray(item.tags) ? item.tags : [],
        product: String(item.product || ''),
        outboundProduct: String(item.outboundProduct || ''),
        summary: String(item.summary || ''),
        nextStep: '',
        priority: 0,
        pendingDraft: undefined,
        isHistorical: true,
        isReal: false,
        isMock: false,
        readOnly: true,
        outboundBlocked: true,
      }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
