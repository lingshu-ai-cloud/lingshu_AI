import { AbortableSemaphore } from '../lib/abortableSemaphore.js';
import { externalJson, ExternalInformationError, object } from './http.js';

export interface TradeQuery { year: number; reporter: number; partner?: number; hs: string; flow: 'M' | 'X' }
export interface TradeRow { partner: number; partnerName: string; valueUsd: number; commodity: string }
export interface TradeSnapshot { query: TradeQuery; rows: TradeRow[]; fetchedAt: string; limited: boolean; cached: boolean; sourceUrl: string }
export const COMTRADE_SOURCE = { title: 'UN Comtrade · 联合国货物贸易统计', uri: 'https://comtradeplus.un.org/' };

export function createComtradeReader(options: { fetcher?: typeof fetch; now?: () => number; apiKey?: () => string } = {}) {
  const cache = new Map<string, { expires: number; value: TradeSnapshot }>();
  const semaphore = new AbortableSemaphore(1);
  let day = '', requests = 0;
  return async (query: TradeQuery, signal?: AbortSignal): Promise<TradeSnapshot> => {
    const now = (options.now ?? Date.now)();
    if (!Number.isInteger(query.year) || query.year < 2000 || query.year > new Date(now).getUTCFullYear()
      || !Number.isInteger(query.reporter) || query.reporter <= 0 || query.reporter > 999
      || (query.partner !== undefined && (!Number.isInteger(query.partner) || query.partner < 0 || query.partner > 999))
      || !/^(?:TOTAL|\d{2}|\d{4}|\d{6})$/.test(query.hs) || !['M', 'X'].includes(query.flow)) {
      throw new ExternalInformationError('comtrade_query_invalid', '请明确统计年份、报告国、进出口方向及 HS 2/4/6 位编码。');
    }
    signal?.throwIfAborted();
    const key = JSON.stringify(query);
    const release = await semaphore.acquire(signal);
    try {
      const saved = cache.get(key);
      if (saved && saved.expires > now) return { ...saved.value, cached: true };
      const today = new Date(now).toISOString().slice(0, 10);
      if (day !== today) { day = today; requests = 0; }
      // Process-local safety ceiling, not a claim about the provider's account-wide quota.
      if (requests >= 200) throw new ExternalInformationError('comtrade_daily_limit', '今日贸易统计查询额度已达本服务上限，请稍后再查。');
      requests++;
      const apiKey = (options.apiKey ?? (() => process.env.UN_COMTRADE_API_KEY ?? ''))().trim();
      const url = new URL(`https://comtradeapi.un.org/${apiKey ? 'data/v1/get' : 'public/v1/preview'}/C/A/HS`);
      url.search = new URLSearchParams({ reporterCode: String(query.reporter), period: String(query.year),
        cmdCode: query.hs, flowCode: query.flow, partner2Code: '0', customsCode: 'C00', motCode: '0',
        maxRecords: '500', includeDesc: 'true', ...(query.partner !== undefined ? { partnerCode: String(query.partner) } : {}) }).toString();
      const data = object(await externalJson(url, { signal, fetcher: options.fetcher, timeoutMs: 12_000,
        init: apiKey ? { headers: { 'Ocp-Apim-Subscription-Key': apiKey } } : undefined }));
      if ((typeof data.error === 'string' && data.error.trim()) || !Array.isArray(data.data) || data.data.length > 500) {
        throw new ExternalInformationError('comtrade_response_invalid', '贸易统计返回异常，本次未采用。');
      }
      const rows: TradeRow[] = [], seen = new Set<number>();
      for (const raw of data.data) {
        const row = object(raw);
        // Never sum across revisions, flows, HS levels, secondary partners or transport/customs breakdowns.
        if (Number(row.reporterCode) !== query.reporter || String(row.period) !== String(query.year) || row.cmdCode !== query.hs
          || row.flowCode !== query.flow || Number(row.partner2Code) !== 0 || Number(row.motCode) !== 0 || row.customsCode !== 'C00') {
          throw new ExternalInformationError('comtrade_scope_mismatch', '贸易统计口径与本次查询不一致，本次未采用。');
        }
        const partner = Number(row.partnerCode);
        if (!Number.isInteger(partner) || partner < 0 || (query.partner !== undefined && partner !== query.partner)
          || typeof row.primaryValue !== 'number' || !Number.isFinite(row.primaryValue) || row.primaryValue < 0) {
          throw new ExternalInformationError('comtrade_response_invalid', '贸易统计包含无效值，本次未采用。');
        }
        if (seen.has(partner)) throw new ExternalInformationError('comtrade_ambiguous_rows', '贸易统计包含多个版本或重复口径，本次不自动合计。');
        seen.add(partner);
        if (query.partner === undefined && (partner === 0 || !/^[A-Z]{3}$/.test(String(row.partnerISO ?? '')))) continue;
        rows.push({ partner, partnerName: String(row.partnerDesc ?? partner).slice(0, 100), valueUsd: row.primaryValue,
          commodity: String(row.cmdDesc ?? query.hs).slice(0, 240) });
      }
      const snapshot: TradeSnapshot = { query: { ...query }, rows: rows.sort((a, b) => b.valueUsd - a.valueUsd),
        fetchedAt: new Date(now).toISOString(), limited: data.data.length >= 500 || Number(data.count) >= 500,
        cached: false, sourceUrl: url.toString() };
      if (cache.size >= 200) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires: now + 6 * 3_600_000, value: snapshot });
      return snapshot;
    } finally { release(); }
  };
}

export const readComtrade = createComtradeReader();
