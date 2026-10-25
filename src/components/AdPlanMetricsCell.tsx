import { Button, Popover } from 'antd';
import type { PlatformAdTask } from '../lib/platformAds';
import type { PlanOperatingData } from './useAdPlanOperatingData';
import { planMetricView } from '../lib/adPlanMetricState';
const time = (v?: string) => v && Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString('zh-CN') : '尚无成功查询';
export default function AdPlanMetricsCell({ task, data, onRetry, disabled }: { task: PlatformAdTask; data?: PlanOperatingData; onRetry: () => void; disabled?: boolean }) {
  const view = planMetricView(task, data), m = data?.metrics, error = data?.metricsError;
  const content = <div className="ads-metric-query-details">
    <p>{error ? error.summary : view.note}</p>{error && <><p>{error.message}</p><small>错误标识：{error.code}{error.status ? ` · HTTP ${error.status}` : ''}</small>{error.requestId && <small>查询编号：{error.requestId}</small>}<small>最近尝试：{time(error.attemptedAt)}</small></>}
    <small>最近成功查询：{time(data?.metricsReceivedAt)}</small>{m?.reportedAt && <small>平台采集：{time(m.reportedAt)}</small>}
    {m?.dataNote && <p>{m.dataNote}</p>}{error && <p>这是数据查询状态，不代表广告执行失败；重试仅重新读取成效。</p>}
  </div>;
  return <div className="ads-plan-metric-cell" data-state={error ? (m ? 'stale' : 'error') : view.state} onClick={event => event.stopPropagation()}>
    <div className="ads-plan-metric-title" title={view.title}>{view.title}</div>
    {error ? <div className="ads-metric-query-actions"><Popover title="成效查询详情" content={content} trigger="click"><Button type="link" size="small" aria-label={`查看成效查询详情：${task.name}`}>{m ? '上次数据' : '查看原因'}</Button></Popover><Button type="link" size="small" aria-label={`重试成效查询：${task.name}`} disabled={disabled || data?.metricsLoading} onClick={onRetry}>重试</Button></div> : <Popover title="成效数据说明" content={content} trigger="click"><Button className="ads-metric-query-note" type="text" size="small" aria-label={`查看成效数据说明：${task.name}`}><small>{view.note}{view.state === 'ready' && m ? ` · 单次 ${m.currency} ${m.costPerResult == null ? '—' : m.costPerResult.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : ''}</small></Button></Popover>}
  </div>;
}
