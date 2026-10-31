import { platformAdsRequest } from './platformAds';
import { adReportPeriodQuery, type AdReportPeriod } from '../../shared/adReportPeriod';

const transient = (error: unknown) => {
  const e = error as { name?: string; status?: number; code?: string } | null;
  if (!e || e.name === 'AbortError') return false;
  if (['NETWORK_ERROR', 'UPSTREAM_TIMEOUT'].includes(e.code || '')) return true;
  if (e.status === undefined && e.name === 'TypeError') return true;
  return [502, 503, 504].includes(e.status || 0) && (!e.code || e.code === 'METRICS_UNAVAILABLE');
};
function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason || new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1000);
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}
/** One recovery attempt for transient GET failures. Never retry auth, rate limits, invalid reports or writes. */
export async function readAdPlanMetrics<T>(taskId: string, signal: AbortSignal, request = platformAdsRequest<T>, wait = pause, period: AdReportPeriod = 7): Promise<T> {
  const path = `/tasks/${encodeURIComponent(taskId)}/metrics${period === 7 ? '' : `?${adReportPeriodQuery(period)}`}`;
  try { return await request(path, { signal }); }
  catch (error) {
    if (signal.aborted || !transient(error)) throw error;
    await wait(signal);
    signal.throwIfAborted();
    return request(path, { signal });
  }
}
