import { externalJson, ExternalInformationError, object } from './http.js';

export const EXCHANGE_RATE_SOURCE = { title: 'ExchangeRate-API · 每日参考汇率', uri: 'https://www.exchangerate-api.com' };
export interface ExchangeRateSnapshot {
  base: string; rates: Readonly<Record<string, string>>; sourceDate: string;
  updatedAt: string; nextUpdateAt: string; fetchedAt: string; cached: boolean;
}

/** One shared reader for assistant queries and the existing business-dynamics report. */
export function createExchangeRateReader(options: { fetcher?: typeof fetch; now?: () => number } = {}) {
  const cache = new Map<string, { expiresAt: number; value: ExchangeRateSnapshot }>();
  return async (base = 'USD', signal?: AbortSignal): Promise<ExchangeRateSnapshot> => {
    if (!/^[A-Z]{3}$/.test(base)) throw new ExternalInformationError('exchange_currency_invalid', '请提供三位币种代码或明确币种名称。');
    signal?.throwIfAborted();
    const now = (options.now ?? Date.now)();
    const saved = cache.get(base);
    if (saved && saved.expiresAt > now) return { ...saved.value, cached: true };
    const data = object(await externalJson(new URL(`https://open.er-api.com/v6/latest/${base}`), { fetcher: options.fetcher, signal }));
    const updated = Number(data.time_last_update_unix) * 1000, next = Number(data.time_next_update_unix) * 1000;
    if (data.result !== 'success' || data.base_code !== base || !Number.isFinite(updated) || !Number.isFinite(next)
      || updated > now + 300_000 || updated < now - 48 * 3_600_000 || next <= now || next <= updated) {
      throw new ExternalInformationError('exchange_snapshot_invalid', '汇率数据缺少有效时间或已经过期，本次未用于换算。');
    }
    const rates: Record<string, string> = Object.create(null);
    for (const [code, value] of Object.entries(object(data.rates))) {
      if (/^[A-Z]{3}$/.test(code) && typeof value === 'number' && Number.isFinite(value) && value > 0 && /^\d+(?:\.\d+)?$/.test(String(value))) rates[code] = String(value);
    }
    if (rates[base] !== '1') throw new ExternalInformationError('exchange_snapshot_invalid', '汇率基准不一致，本次未用于换算。');
    const value: ExchangeRateSnapshot = { base, rates: Object.freeze(rates), sourceDate: new Date(updated).toISOString().slice(0, 10),
      updatedAt: new Date(updated).toISOString(), nextUpdateAt: new Date(next).toISOString(), fetchedAt: new Date(now).toISOString(), cached: false };
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(base, { value, expiresAt: Math.min(next, now + 3_600_000) });
    return value;
  };
}

export const readExchangeRates = createExchangeRateReader();
