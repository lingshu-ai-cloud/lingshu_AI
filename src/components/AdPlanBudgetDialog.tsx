import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, InputNumber, Modal, Select, Space, Table, Tag } from 'antd';
import { platformAdsApi, platformAdsRequest, type PlatformAdTask } from '../lib/platformAds';
import type { MetaPlanAudit } from '../../shared/metaPlanAudit';
import AdExecutionReceipts from './AdExecutionReceipts';
import type { PlanOperatingMetrics } from './AdPlanManagement';
type Row = Record<string, unknown>;
type Policy = { allowedActions: string[]; executionProviders: string[]; reason: string };
const n = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const msg = (e: unknown) => e instanceof Error ? e.message : '请求失败，请重新读取';
export default function AdPlanBudgetDialog({ task, onClose, onUpdate, inline = false, onBusyChange, onReadback }: { onReadback?: () => void; inline?: boolean; onBusyChange?: (busy: boolean) => void; task: PlatformAdTask; onClose: () => void; onUpdate: (task: PlatformAdTask) => void }) {
  const [total, setTotal] = useState<number | null>(task.budget), [daily, setDaily] = useState<number | null>(task.configuration.dailyBudget);
  const [records, setRecords] = useState<Row[]>([]), [audit, setAudit] = useState<MetaPlanAudit | null>(null), [metrics, setMetrics] = useState<PlanOperatingMetrics | null>(null), [policy, setPolicy] = useState<Policy | null>(null);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [errors, setErrors] = useState<string[]>([]), [feedback, setFeedback] = useState(''), [refresh, setRefresh] = useState(0), [resource, setResource] = useState('');
  const lock = useRef(false), request = useRef<{ fingerprint: string; id: string } | null>(null), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const c = new AbortController(); setReady(false); setErrors([]); setAudit(null); setPolicy(null); setMetrics(null);
    void (async () => {
      const results = await Promise.allSettled([
        platformAdsRequest<{ items: Row[] }>(`/tasks/${encodeURIComponent(task.id)}/executions`, { signal: c.signal }),
        platformAdsRequest<{ releasePolicy: Policy }>('/connections', { signal: c.signal }),
        platformAdsRequest<PlanOperatingMetrics>(`/tasks/${encodeURIComponent(task.id)}/metrics`, { signal: c.signal }),
        task.channels.every(ch => ['Facebook', 'Instagram'].includes(ch)) ? platformAdsRequest<MetaPlanAudit>(`/tasks/${encodeURIComponent(task.id)}/meta-audit`, { signal: c.signal }) : Promise.resolve(null),
      ]);
      if (c.signal.aborted) return;
      const [receipts, release, report, platform] = results;
      const failures: string[] = [];
      if (receipts.status === 'fulfilled') setRecords(receipts.value.items); else failures.push(`执行历史：${msg(receipts.reason)}`);
      if (release.status === 'fulfilled') setPolicy(release.value.releasePolicy); else failures.push(`执行能力：${msg(release.reason)}`);
      if (report.status === 'fulfilled') setMetrics(report.value); else failures.push(`效果数据：${msg(report.reason)}`);
      if (platform.status === 'fulfilled') setAudit(platform.value); else failures.push(`平台预算：${msg(platform.reason)}`);
      setErrors(failures); setReady(receipts.status === 'fulfilled' && release.status === 'fulfilled');
    })();
    return () => c.abort();
  }, [task.id, task.version, refresh]);
  const executed = task.status !== 'draft' || records.some(r => r.status !== 'FAILED');
  const creates = records.filter(r => r.action === 'create' && r.status === 'VERIFIED' && typeof r.resourceId === 'string');
  const chosen = creates.find(r => r.resourceId === resource) || (creates.length === 1 ? creates[0] : undefined);
  const live = audit?.entries.find(e => e.campaignId === chosen?.resourceId);
  const pending = records.some(r => ['UNKNOWN', 'EXECUTING', 'PROVIDER_ACCEPTED'].includes(String(r.status)));
  const imported = task.creationSource === 'platform_import';
  const editable = !imported && task.managementMode === 'manual';
  const canAdjust = policy?.allowedActions.includes('adjust_budget') && policy.executionProviders.includes('meta') && !!live && live.currency === task.currency && audit?.taskVersion === task.version && !audit?.truncated && !audit?.pendingCount;
  useEffect(() => { if (live?.dailyBudget != null) setDaily(live.dailyBudget); }, [live?.executionId, live?.dailyBudget]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const submit = async () => {
    if (lock.current || !ready || pending || !editable || total == null || total < 1 || daily != null && (daily < 1 || daily > total) || executed && (!canAdjust || !chosen || daily == null)) return;
    lock.current = true; setBusy(true); setFeedback('');
    try {
      if (!executed) {
        const updated = await platformAdsApi.updateTask(task.id, { name: task.name, video: task.video, goal: task.goal, market: task.market, channels: task.channels, currency: task.currency, budget: total, configuration: { ...task.configuration, dailyBudget: daily }, expectedVersion: task.version || 1 });
        if (!active.current) return; onUpdate(updated); setFeedback('草稿预算已保存，尚未修改平台广告。');
      } else {
        const input = { expectedVersion: task.version || 1, connectionId: String(chosen!.connectionId), resourceId: String(chosen!.resourceId), action: 'adjust_budget', dailyBudget: daily };
        const fingerprint = JSON.stringify(input);
        if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
        const result = await platformAdsRequest<{ execution: Row }>(`/tasks/${encodeURIComponent(task.id)}/execute`, { method: 'POST', body: JSON.stringify({ ...input, requestId: request.current.id }) });
        if (!active.current) return;
        if (['VERIFIED', 'FAILED'].includes(String(result.execution.status))) request.current = null;
        setRecords(old => [result.execution, ...old.filter(r => r.id !== result.execution.id)]);
        setFeedback(result.execution.status === 'VERIFIED' ? '平台日预算已核验，请查看执行回执；平台预算读回可能存在缓存延迟。' : '预算调整尚未核验成功，请先核对原回执，不要重复提交。');
      }
      setRefresh(v => v + 1); onReadback?.();
    } catch (e) { if (active.current) { setFeedback(`预算处理失败：${msg(e)}`); setRefresh(v => v + 1); onReadback?.(); } }
    finally { lock.current = false; if (active.current) setBusy(false); }
  };
  const content = <>
    {!inline && <Descriptions size="small" column={2} items={[{ key: 'goal', label: '推广目标', children: task.goal }, { key: 'market', label: '市场', children: task.market }, { key: 'spent', label: '最近7天消耗', children: metrics ? `${metrics.currency} ${n(metrics.spend)}` : '尚未读取' }, { key: 'result', label: metrics?.metricLabel || '目标结果', children: metrics ? `${n(metrics.results)} · 单次成本 ${metrics.currency} ${n(metrics.costPerResult)}` : '—' }, { key: 'reported', label: '数据采集', children: metrics?.reportedAt ? new Date(metrics.reportedAt).toLocaleString('zh-CN') : '暂无平台报告' }, { key: 'version', label: '计划版本', children: task.version || 1 }]}/>}
    {metrics?.stale && <Alert type="warning" title={metrics.dataNote || '当前为历史快照，不能据此判断即时投放表现。'}/>}
    {errors.map(error => <Alert key={error} type="warning" showIcon title={error}/>)}
    {policy && !policy.allowedActions.includes('adjust_budget') && executed && <Alert type="info" showIcon title={policy.reason}/>}
    {imported && <Alert type="info" showIcon title="平台导入计划当前只读，请在原平台调整预算。"/>}
    {!imported && !editable && <Alert type="warning" showIcon title="当前计划采用 AI 建议、审批或授权托管，请在计划详情确认管理方式与边界后操作。"/>}
    {executed && policy?.allowedActions.includes('adjust_budget') && !canAdjust && <Alert type="warning" showIcon title="平台预算或资源尚未完整核对，暂不能确认调整。请重新核对数据。"/>}
    {pending && <Alert type="warning" showIcon title="已有执行结果待核对，先核对原回执，不能重复调整。"/>}
    <form className="ads-form-fields" onSubmit={e => { e.preventDefault(); void submit(); }}>
      {creates.length > 1 && <label>投放资源<Select aria-label="预算对应投放资源" value={resource || undefined} onChange={setResource} options={creates.map((r, index) => ({ value: String(r.resourceId), label: `已核验投放 ${index + 1} · ${String(r.createdAt || '')}` }))}/></label>}
      <label>计划总预算上限（{task.currency}）<InputNumber aria-label="计划总预算上限" min={1} max={1000000} precision={2} value={total} disabled={executed || !editable || busy} onChange={setTotal}/></label>
      <label>日预算（{task.currency}）<InputNumber aria-label="计划日预算" min={1} max={total || task.budget} precision={2} value={daily} disabled={!editable || busy || executed && !canAdjust} onChange={setDaily}/></label>
      {executed ? <p>平台读回：日预算 {task.currency} {n(live?.dailyBudget)} · 系列花费限额 {task.currency} {n(live?.spendCap)}。当前后端仅支持调整日预算，尚无已执行计划追加总额度接口；不会仅修改本地上限冒充平台已生效。</p> : <p>保存修改草稿预算；账户、素材、文案与国家配置保持原值。不会充值、创建或启动广告。</p>}
      <Space wrap><Button type="primary" htmlType="submit" loading={busy} disabled={!ready || pending || !editable || executed && !canAdjust || total == null || total < 1 || daily != null && (daily < 1 || daily > total) || executed && (daily == null || !chosen)}>{executed ? '确认调整日预算' : '保存草稿预算'}</Button><Button disabled={busy} onClick={() => setRefresh(v => v + 1)}>重新核对数据</Button></Space>
    </form>
    {feedback && <Alert className="mt-4" type={feedback.includes('失败') ? 'error' : feedback.includes('尚未') && executed ? 'warning' : 'success'} showIcon title={feedback}/>}
    <details className="ads-budget-history" open={inline ? undefined : true}><summary>预算调整记录与平台回执</summary>
    <h3>平台日预算调整记录</h3>{!executed && <p>草稿预算修改以计划版本体现；当前后端没有逐次草稿预算变更历史。</p>}{ready && <Table<Row> rowKey={r => String(r.id)} size="small" pagination={{ pageSize: 5 }} dataSource={records.filter(r => r.action === 'adjust_budget')} columns={[{ title: '时间', dataIndex: 'createdAt' }, { title: '拟议日预算', render: (_, r) => `${task.currency} ${n(typeof r.expectedDailyBudget === 'number' ? r.expectedDailyBudget : null)}` }, { title: '执行结果', render: (_, r) => <Tag>{r.status === 'VERIFIED' ? '平台已核验' : r.status === 'FAILED' ? '失败' : '待核验'}</Tag> }]}/>}
    {ready ? <AdExecutionReceipts taskId={task.id} records={records.filter(r => r.action === 'adjust_budget' || ['UNKNOWN', 'EXECUTING', 'PROVIDER_ACCEPTED'].includes(String(r.status)))} onRefresh={async () => { const result = await platformAdsRequest<{ items: Row[] }>(`/tasks/${encodeURIComponent(task.id)}/executions`); setRecords(result.items); setRefresh(v => v + 1); }}/> : <p role="status">执行历史尚未完成核对，不能据此判断没有执行记录。</p>}
    </details>
  </>;
  return inline ? <section className="ads-inline-budget" aria-label={`预算管理 · ${task.name}`}>{content}</section> : <Modal open title={`预算管理 · ${task.name}`} width={900} footer={null} onCancel={() => { if (!lock.current) onClose(); }} closable={!busy} keyboard={!busy} mask={{ closable: false }} className="ads-plan-dialog" styles={{ body: { maxHeight: '76vh', overflowY: 'auto' } }}>{content}</Modal>;
}
