import { isLocalExampleAd } from '../lib/localExampleOrigin';
import { useEffect, useState } from 'react';
import { Alert, Button, Input, Select, Space, Table, Tag } from 'antd';
import { type PlatformAdTask } from '../lib/platformAds';
import { managementModeLabels } from '../lib/platformAdsDomain';
import { useAdAccountDirectory } from './AdAccountDirectory';
import { useAdPlanOperatingData } from './useAdPlanOperatingData';
import { planAdvice, planLiveEntries, planStatusText } from '../lib/adPlanRow';
import AdPlanBudgetDialog from './AdPlanBudgetDialog';
import AdPlanThumbnail from './AdPlanThumbnail';
import AdPlanMetricsCell from './AdPlanMetricsCell';
export type PlanOperatingMetrics = { status?: string; reason?: string; source?: string; stale?: boolean; dataNote?: string; currency: string; reportedAt: string; spend: number | null; impressions: number | null; clicks: number | null; results: number | null; costPerResult: number | null; metricLabel: string };
const n = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
export default function AdPlanManagement({ tasks, loading, error, onOpen, onUpdate, onAI, previewMode = false, readOnly = false }: { readOnly?: boolean; previewMode?: boolean; tasks: PlatformAdTask[]; loading: boolean; error?: string; onOpen: (id: string) => void; onUpdate: (task: PlatformAdTask) => void; onAI: (id: string) => void }) {
  const directory = useAdAccountDirectory();
  const [expanded, setExpanded] = useState<string[]>([]), [budgetBusy, setBudgetBusy] = useState(false);
  const [search, setSearch] = useState(''), [goal, setGoal] = useState(''), [currency, setCurrency] = useState(''), [account, setAccount] = useState(''), [channel, setChannel] = useState('');
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const filtered = tasks.filter(t => (!search.trim() || `${t.name} ${t.video} ${t.market}`.toLowerCase().includes(search.trim().toLowerCase())) && (!goal || t.goal === goal) && (!currency || t.currency === currency) && (!account || t.configuration.accountConnectionId === account) && (!channel || t.channels.includes(channel)));
  const draftNameConflict = (task: PlatformAdTask) => /仅草稿|不投放|keep paused/i.test(task.name) && planStatusText(task, current[task.id]) === '投放中';
  const visible = filtered.slice((page - 1) * 10, page * 10);
  const { items: current, loading: busy, retryMetrics } = useAdPlanOperatingData(visible, refresh, previewMode);
  useEffect(() => { const timer = window.setInterval(() => { if (document.visibilityState === 'visible' && !busy && !budgetBusy) setRefresh(v => v + 1); }, 60_000); return () => window.clearInterval(timer); }, [busy, budgetBusy]);
  const filter = (setter: (value: string) => void) => (value: string) => { if (budgetBusy) return; setter(value); setPage(1); setExpanded([]); };
  return <section className="ads-plan-management" aria-label="投放计划管理">
    <div className="ads-plan-filter-scroll" role="group" aria-label="计划筛选工具栏" tabIndex={0}><div className="ads-plan-filters">
      <Input.Search disabled={budgetBusy} aria-label="搜索投放计划" placeholder="搜索计划" value={search} allowClear onChange={e => filter(setSearch)(e.target.value)}/>
      <Select disabled={budgetBusy} aria-label="筛选计划目标" value={goal} onChange={filter(setGoal)} options={[{ value: '', label: '全部目标' }, ...[...new Set(tasks.map(t => t.goal))].map(value => ({ value, label: value }))]}/>
      <Select disabled={budgetBusy} aria-label="筛选预算币种" value={currency} onChange={filter(setCurrency)} options={[{ value: '', label: '全部币种' }, { value: 'CNY', label: 'CNY' }, { value: 'USD', label: 'USD' }]}/>
      <Select disabled={budgetBusy} aria-label="筛选计划账户" value={account} onChange={filter(setAccount)} options={[{ value: '', label: '全部账户' }, ...directory.items.filter(a => a.localConnectionId).map(a => ({ value: a.localConnectionId!, label: `${a.name} · ${a.currency}` }))]}/>
      <Select disabled={budgetBusy} aria-label="筛选渠道" value={channel} onChange={filter(setChannel)} options={[{ value: '', label: '全部渠道' }, ...['Facebook', 'Instagram', 'TikTok', 'YouTube'].map(value => ({ value, label: value }))]}/>
      <Button disabled={budgetBusy} loading={busy} onClick={() => setRefresh(v => v + 1)}>刷新效果</Button>
    </div></div>
    {tasks.some(task => isLocalExampleAd(task.id)) && <p className="mb-3 text-xs text-text-muted">示例不计入经营报告</p>}
    {error && <Alert type="error" showIcon title={error}/>}
    <Table<PlatformAdTask> className="ads-compact-plan-table" size="small" rowKey="id" loading={loading} dataSource={visible} pagination={{ current: page, pageSize: 10, total: filtered.length, showSizeChanger: false, disabled: budgetBusy, onChange: value => { setPage(value); setExpanded([]); } }} scroll={{ x: 862 }} locale={{ emptyText: error ? '计划目录暂未读取成功' : '当前筛选暂无计划' }}
      onRow={task => ({ onClick: event => { if (!budgetBusy && !(event.target as HTMLElement).closest('button, a, input, select, textarea')) setExpanded(keys => keys.includes(task.id) ? [] : [task.id]); } })}
      expandable={{ expandedRowKeys: expanded, showExpandColumn: false, expandRowByClick: false, onExpand: (open, task) => { if (!budgetBusy) setExpanded(open ? [task.id] : []); }, expandedRowRender: task => <div className="ads-plan-row-panel">
        <div className="ads-plan-row-panel-heading"><strong>{task.name}{isLocalExampleAd(task.id) && <Tag className="ml-2">本地示例</Tag>}</strong><Button size="small" disabled={budgetBusy} onClick={() => setExpanded([])}>收起</Button></div>
        {draftNameConflict(task) && <Alert type="warning" showIcon title="名称与真实投放状态不一致" description="计划名称包含仅草稿或不投放，但平台回执显示正在投放。请核对原操作记录及预算；页面不会自动修改广告状态。" />}
        <p className="ads-plan-advice-detail"><strong>AI 建议：</strong>{planAdvice(task, current[task.id]).text} <small>{planAdvice(task, current[task.id]).detail}</small></p>
        {readOnly ? <p>计划预算 {task.currency} {n(task.budget)} · 计划日预算 {task.currency} {n(task.configuration.dailyBudget)}</p> : !previewMode ? <AdPlanBudgetDialog inline task={task} onClose={() => setExpanded([])} onUpdate={onUpdate} onReadback={() => setRefresh(v => v + 1)} onBusyChange={setBudgetBusy}/> : <p>演示数据仅供查看预算。</p>}
        <Space wrap><Button disabled={budgetBusy} onClick={() => onOpen(task.id)}>素材配置与投放操作</Button><Button disabled={budgetBusy} onClick={() => onAI(task.id)}>查看 AI 决策与授权记录</Button></Space>
      </div> }} columns={[
      { title: '缩略图', key: 'cover', width: 80, render: (_, task) => <div onClick={event => event.stopPropagation()}><AdPlanThumbnail task={task} entry={planLiveEntries(task, current[task.id])[0]}/></div> },
      { title: '计划标题', key: 'name', width: 210, render: (_, task) => <><Button type="link" className="ads-compact-plan-title" title={task.name} aria-expanded={expanded.includes(task.id)} disabled={budgetBusy} onClick={event => { event.stopPropagation(); setExpanded(keys => keys.includes(task.id) ? [] : [task.id]); }}>{task.name}</Button>{isLocalExampleAd(task.id) && <Tag>本地示例</Tag>}<small>{task.goal} · {task.market}</small></> },
      { title: '投放状态', key: 'status', width: 104, render: (_, task) => <><Tag>{planStatusText(task, current[task.id])}</Tag>{draftNameConflict(task) && <Tag color="warning">投放状态待核对</Tag>}<small>{managementModeLabels[task.managementMode]}</small></> },
      { title: '预算与消耗', key: 'budget', width: 158, render: (_, task) => { const data = current[task.id], entries = planLiveEntries(task, data), live = entries.length === 1 && entries[0].currency === task.currency ? entries[0] : null; return <div title={data?.audit ? `平台核对：${new Date(data.audit.checkedAt).toLocaleString('zh-CN')}` : '平台预算待回传'}><div>{live ? `平台日预算 ${task.currency} ${n(live.dailyBudget)}` : entries.length > 1 ? `${entries.length} 组平台预算 · 展开核对` : `计划日预算 ${task.currency} ${n(task.configuration.dailyBudget)}`}</div><small>{data?.metrics ? `${data.metricsError ? '上次消耗' : '消耗'} ${data.metrics.currency} ${n(data.metrics.spend)}` : '消耗待回传'}</small></div>; } },
      { title: '关键成效', key: 'metrics', width: 144, render: (_, task) => <AdPlanMetricsCell task={task} data={current[task.id]} disabled={budgetBusy || busy} onRetry={() => retryMetrics(task.id)}/> },
      { title: 'AI 建议', key: 'advice', width: 166, render: (_, task) => { const advice = planAdvice(task, current[task.id]); return <div title={`${advice.text} · ${advice.detail} · ${advice.time}`}><div className="ads-plan-advice-summary">{advice.text}</div><small>{advice.detail}</small></div>; } },
    ]}/>
  </section>;
}
