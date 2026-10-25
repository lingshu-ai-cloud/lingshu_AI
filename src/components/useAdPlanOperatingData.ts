import { useEffect, useState } from 'react';
import { platformAdsRequest, type PlatformAdTask } from '../lib/platformAds';
import type { MetaPlanAudit } from '../../shared/metaPlanAudit';
import type { PlanOperatingMetrics } from './AdPlanManagement';
import type { ManagedRecord } from '../lib/adManagedSummary';
import { readAdPlanMetrics } from '../lib/adPlanMetricsRequest';
import { metricQueryError, type MetricQueryError } from '../lib/adPlanMetricState';
export type PlanOperatingData = { metrics?: PlanOperatingMetrics; metricsLoading?: boolean; metricsError?: MetricQueryError; metricsReceivedAt?: string; audit?: MetaPlanAudit; runs?: ManagedRecord[]; errors: string[] };
/** Cached metrics are limited to the identical visible task/version scope. No persistent or cross-tenant cache. */
export function useAdPlanOperatingData(tasks: PlatformAdTask[], refresh: number, disabled: boolean) {
  const scope = tasks.map(t => `${t.id}:${t.version || 1}`).join(',');
  const [snapshot, setSnapshot] = useState<{ scope: string; refresh: number; items: Record<string, PlanOperatingData> }>({ scope: '', refresh: -1, items: {} });
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState({ id: '', tick: 0 });
  useEffect(() => {
    const c = new AbortController();
    const previous = snapshot.scope === scope ? snapshot.items : {};
    const single = snapshot.scope === scope && snapshot.refresh === refresh && retry.id && Object.keys(previous).length > 0;
    const selected = single ? tasks.filter(t => t.id === retry.id) : tasks;
    setLoading(!disabled);
    if (disabled) { setSnapshot({ scope, refresh, items: {} }); return () => c.abort(); }
    setSnapshot({ scope, refresh, items: Object.fromEntries(tasks.map(task => [task.id, { ...previous[task.id], metricsLoading: !single || task.id === retry.id, errors: previous[task.id]?.errors || [] }])) });
    void (async () => {
      for (let i = 0; i < selected.length; i += 3) {
        await Promise.all(selected.slice(i, i + 3).map(async task => {
          const prior = previous[task.id];
          const result: PlanOperatingData = single ? { ...prior, metricsLoading: true, metricsError: undefined, errors: (prior?.errors || []).filter(e => e !== '效果读取失败') } : { metrics: prior?.metrics, metricsReceivedAt: prior?.metricsReceivedAt, metricsLoading: true, errors: [] };
          const publish = () => { if (!c.signal.aborted) setSnapshot(old => ({ scope, refresh, items: { ...(old.scope === scope ? old.items : {}), [task.id]: { ...result, errors: [...result.errors] } } })); };
          publish();
          await Promise.all([
            readAdPlanMetrics<PlanOperatingMetrics>(task.id, c.signal).then(value => { result.metrics = value; result.metricsReceivedAt = new Date().toISOString(); }).catch(error => { result.metricsError = metricQueryError(error); result.errors.push('效果读取失败'); }).finally(() => { result.metricsLoading = false; publish(); }),
            !single && task.channels.every(ch => ['Facebook', 'Instagram'].includes(ch)) ? platformAdsRequest<MetaPlanAudit>(`/tasks/${encodeURIComponent(task.id)}/meta-audit`, { signal: c.signal }).then(value => { result.audit = value; }).catch(() => { result.errors.push('平台状态与预算读取失败'); }).finally(publish) : Promise.resolve(),
            !single ? platformAdsRequest<{ runs: ManagedRecord[] }>(`/tasks/${encodeURIComponent(task.id)}/automation`, { signal: c.signal }).then(value => { result.runs = value.runs; }).catch(() => { result.errors.push('AI 记录读取失败'); }).finally(publish) : Promise.resolve(),
          ]);
        }));
        if (c.signal.aborted) return;
      }
      if (!c.signal.aborted) setLoading(false);
    })();
    return () => c.abort();
  }, [scope, refresh, disabled, retry.tick]);
  return { items: snapshot.scope === scope ? snapshot.items : {}, loading, retryMetrics: (id: string) => setRetry(v => ({ id, tick: v.tick + 1 })) };
}
