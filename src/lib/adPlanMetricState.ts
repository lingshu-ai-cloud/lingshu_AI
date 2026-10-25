import type { PlatformAdTask } from './platformAds';
import type { PlanOperatingData } from '../components/useAdPlanOperatingData';
export type MetricQueryError = { code: string; status?: number; requestId?: string; message: string; summary: string; attemptedAt: string };
export function metricQueryError(error: unknown): MetricQueryError {
  const e = error instanceof Error ? error as Error & { code?: string; status?: number; requestId?: string } : null;
  const code = String(e?.code || (e?.name === 'TypeError' ? 'NETWORK_ERROR' : 'METRICS_UNAVAILABLE'));
  const summary = e?.status === 401 ? '登录状态需要更新' : e?.status === 403 ? '当前账号无权读取' : /AUTH|TOKEN|PERMISSION/.test(code) || ['10', '190', '200'].includes(code) ? '平台授权需要检查' : /NETWORK|TIMEOUT/.test(code) ? '连接超时或网络异常' : /RATE|LIMIT/.test(code) || ['4', '17', '613'].includes(code) ? '平台请求暂时受限' : code === 'METRICS_NOT_READY' ? '平台报告尚未完整返回' : '本次查询未完成';
  return { code, status: e?.status, requestId: e?.requestId, message: e?.message || '服务暂时无法返回成效，请重试。', summary, attemptedAt: new Date().toISOString() };
}
export function planMetricView(task: PlatformAdTask, data?: PlanOperatingData) {
  const m = data?.metrics;
  const error = data?.metricsError;
  const pending = !!data?.metricsLoading;
  if (!m) return { state: error ? 'error' : 'loading', title: error ? '成效暂不可用' : '正在查询成效', note: error?.summary || '尚未取得报告', stale: false };
  const stale = !!error;
  if (m.status === 'not_ready' || m.source === 'none') {
    const audit = data?.audit;
    const draft = task.status === 'draft' && audit?.taskId === task.id && audit.taskVersion === task.version && !audit.truncated && audit.pendingCount === 0 && !audit.entries.length;
    return { state: 'not_ready', title: draft ? '尚未投放' : '尚无可核验报告', note: stale ? '刷新未成功 · 上次查询结果' : pending ? '正在刷新上次查询结果' : draft ? '草稿暂无投放成效' : '等待平台报告关联', stale };
  }
  const empty = [m.spend, m.impressions, m.clicks, m.results].every(v => v == null);
  if (m.source === 'provider' && empty) return { state: 'empty', title: '平台暂无成效数据', note: stale ? '刷新未成功 · 上次查询结果' : pending ? '正在刷新' : '查询成功，等待平台产生数据', stale };
  return { state: 'ready', title: `${m.metricLabel || '目标结果'} ${m.results == null ? '—' : m.results.toLocaleString('zh-CN')}`, note: stale ? '上次数据 · 刷新未成功' : pending ? '上次数据 · 正在刷新' : m.stale || m.source !== 'provider' ? '历史快照' : '平台回传', stale };
}
