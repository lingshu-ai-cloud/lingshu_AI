import { isLocalExampleAd } from '../lib/localExampleOrigin';
import { useEffect, useState } from 'react';
import { Alert, Button, DatePicker, Drawer, Input, Select, Space, Table, Tag } from 'antd';
import { type PlatformAdTask } from '../lib/platformAds';
import { managementModeLabels } from '../lib/platformAdsDomain';
import { useAdAccountDirectory } from './AdAccountDirectory';
import { useAdPlanOperatingData } from './useAdPlanOperatingData';
import { planAdvice, planLiveEntries, planStatusText } from '../lib/adPlanRow';
import AdPlanBudgetDialog from './AdPlanBudgetDialog';
import AdPlanThumbnail from './AdPlanThumbnail';
import AdPlanMetricsCell from './AdPlanMetricsCell';
import AdAccountSpendSummary from './AdAccountSpendSummary';
import AdAccountStatusBanner from './AdAccountStatusBanner';
export type PlanOperatingMetrics = { status?: string; reason?: string; source?: string; stale?: boolean; dataNote?: string; window?: { since: string; until: string }; currency: string; reportedAt: string; spend: number | null; impressions: number | null; clicks: number | null; results: number | null; costPerResult: number | null; metricLabel: string };
const n = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
export default function AdPlanManagement({ tasks, loading, error, onOpen, onUpdate, onAI, onOpenAccounts, previewMode = false, readOnly = false }: { readOnly?: boolean; previewMode?: boolean; tasks: PlatformAdTask[]; loading: boolean; error?: string; onOpen: (id: string) => void; onUpdate: (task: PlatformAdTask) => void; onAI: (id: string) => void; onOpenAccounts?: () => void }) {
  const directory = useAdAccountDirectory();
  const [selectedId, setSelectedId] = useState<string | null>(null), [budgetBusy, setBudgetBusy] = useState(false);
  const selectedTask = tasks.find(task => task.id === selectedId);
  const [search, setSearch] = useState(''), [goal, setGoal] = useState(''), [currency, setCurrency] = useState(''), [account, setAccount] = useState(''), [channel, setChannel] = useState('');
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0), [periodMode, setPeriodMode] = useState<7 | 30 | 'date'>(7), [date, setDate] = useState(''), [lastPreset, setLastPreset] = useState<7 | 30>(7);
  const pendingDate = periodMode === 'date' && !date;
  const days = periodMode === 'date' ? date || lastPreset : periodMode;
  const filtered = tasks.filter(t => (!search.trim() || `${t.name} ${t.video} ${t.market}`.toLowerCase().includes(search.trim().toLowerCase())) && (!goal || t.goal === goal) && (!currency || t.currency === currency) && (!account || t.configuration.accountConnectionId === account) && (!channel || t.channels.includes(channel)));
  const draftNameConflict = (task: PlatformAdTask) => /仅草稿|不投放|keep paused/i.test(task.name) && planStatusText(task, current[task.id]) === '已启用 · 投放待核验';
  const visible = filtered.slice((page - 1) * 10, page * 10);
  const { items: current, loading: busy, retryMetrics } = useAdPlanOperatingData(visible, refresh, previewMode, days);
  const auditIssues = selectedTask && !current[selectedTask.id]?.errors?.includes('平台状态与预算读取失败') ? [...new Set(planLiveEntries(selectedTask, current[selectedTask.id]).flatMap(entry => entry.issues.map(issue => issue.message)).filter(Boolean))].slice(0, 3) : [];
  useEffect(() => { const timer = window.setInterval(() => { if (document.visibilityState === 'visible' && !busy && !budgetBusy) setRefresh(v => v + 1); }, 60_000); return () => window.clearInterval(timer); }, [busy, budgetBusy]);
  const filter = (setter: (value: string) => void) => (value: string) => { if (budgetBusy) return; setter(value); setPage(1); setSelectedId(null); };
  return <section className="ads-plan-management" aria-label="投放计划管理">
    {!previewMode && onOpenAccounts && <AdAccountStatusBanner accounts={directory.items}/>}
    <div className="ads-plan-filter-scroll" role="group" aria-label="计划筛选工具栏" tabIndex={0}><div className={`ads-plan-filters${periodMode === 'date' ? ' has-date' : ''}`}>
      <Input.Search disabled={budgetBusy} aria-label="搜索投放计划" placeholder="搜索计划" value={search} allowClear onChange={e => filter(setSearch)(e.target.value)}/>
      <Select disabled={budgetBusy} aria-label="筛选计划目标" value={goal} onChange={filter(setGoal)} options={[{ value: '', label: '全部目标' }, ...[...new Set(tasks.map(t => t.goal))].map(value => ({ value, label: value }))]}/>
      <Select disabled={budgetBusy} aria-label="筛选预算币种" value={currency} onChange={filter(setCurrency)} options={[{ value: '', label: '全部币种' }, { value: 'CNY', label: 'CNY' }, { value: 'USD', label: 'USD' }]}/>
      <Select disabled={budgetBusy} aria-label="筛选计划账户" value={account} onChange={filter(setAccount)} options={[{ value: '', label: '全部账户' }, ...directory.items.filter(a => a.localConnectionId).map(a => ({ value: a.localConnectionId!, label: `${a.name} · ${a.currency}` }))]}/>
      <Select disabled={budgetBusy} aria-label="筛选渠道" value={channel} onChange={filter(setChannel)} options={[{ value: '', label: '全部渠道' }, ...['Facebook', 'Instagram', 'TikTok', 'YouTube'].map(value => ({ value, label: value }))]}/>
      <Select disabled={budgetBusy} aria-label="筛选统计时间" value={periodMode} onChange={value => { setPeriodMode(value); if (value !== 'date') setLastPreset(value); setDate(''); }} options={[{ value: 7, label: '近7天' }, { value: 30, label: '近30天' }, { value: 'date', label: '指定日期' }]}/>
      {periodMode === 'date' && <DatePicker disabled={budgetBusy} aria-label="选择统计日期" placeholder="选择统计日期" onChange={(_, value) => setDate(typeof value === 'string' ? value : '')}/>}
      <Button disabled={budgetBusy} loading={busy} onClick={() => setRefresh(v => v + 1)}>刷新效果</Button>
    </div></div>
    {!previewMode && account && !pendingDate && <AdAccountSpendSummary account={directory.items.find(item => item.localConnectionId === account)} refresh={refresh} days={days}/>}
    {tasks.some(task => isLocalExampleAd(task.id)) && <p className="mb-3 text-xs text-text-muted">示例不计入经营报告</p>}
    {error && <Alert type="error" showIcon title={error}/>}
    <Table<PlatformAdTask> className="ads-compact-plan-table" size="small" rowKey="id" loading={loading} dataSource={visible} pagination={{ current: page, pageSize: 10, total: filtered.length, showSizeChanger: false, disabled: budgetBusy, onChange: value => { setPage(value); setSelectedId(null); } }} scroll={{ x: 862 }} locale={{ emptyText: error ? '计划目录暂未读取成功' : '当前筛选暂无计划' }}
      onRow={task => ({ onClick: event => { if (!budgetBusy && !(event.target as HTMLElement).closest('button, a, input, select, textarea')) setSelectedId(task.id); } })}
      columns={[
      { title: '缩略图', key: 'cover', width: 80, render: (_, task) => <div onClick={event => event.stopPropagation()}><AdPlanThumbnail task={task} entry={planLiveEntries(task, current[task.id])[0]}/></div> },
      { title: '计划标题', key: 'name', width: 210, render: (_, task) => <><Button type="link" className="ads-compact-plan-title" title={task.name} aria-haspopup="dialog" disabled={budgetBusy} onClick={event => { event.stopPropagation(); setSelectedId(task.id); }}>{task.name}</Button>{isLocalExampleAd(task.id) && <Tag>本地示例</Tag>}<small>{task.goal} · {task.market}</small></> },
      { title: '投放状态', key: 'status', width: 104, render: (_, task) => <><Tag>{planStatusText(task, current[task.id])}</Tag>{draftNameConflict(task) && <Tag color="warning">投放状态待核对</Tag>}<small>{managementModeLabels[task.managementMode]}</small></> },
      { title: '预算与消耗', key: 'budget', width: 158, render: (_, task) => { const data = current[task.id], entries = planLiveEntries(task, data), live = entries.length === 1 && entries[0].currency === task.currency ? entries[0] : null; return <div title={data?.audit ? `平台核对：${new Date(data.audit.checkedAt).toLocaleString('zh-CN')}` : '平台预算待回传'}><div>{live ? `平台日预算 ${task.currency} ${n(live.dailyBudget)}` : entries.length > 1 ? `${entries.length} 组平台预算 · 查看详情` : `计划日预算 ${task.currency} ${n(task.configuration.dailyBudget)}`}</div><small>{pendingDate ? '请选择统计日期' : data?.metrics && typeof data.metrics.spend === 'number' && Number.isFinite(data.metrics.spend) ? `${data.metricsError ? '上次计划消耗' : `${typeof days === 'string' ? days : `近${days}天`}计划消耗`} ${data.metrics.currency} ${n(data.metrics.spend)}` : data?.metricsError ? '消耗读取失败' : '暂无消耗数据'}</small></div>; } },
      { title: '关键成效', key: 'metrics', width: 144, render: (_, task) => pendingDate ? '请选择统计日期' : <AdPlanMetricsCell task={task} data={current[task.id]} disabled={budgetBusy || busy} onRetry={() => retryMetrics(task.id)}/> },
      { title: 'AI 建议', key: 'advice', width: 166, render: (_, task) => { const advice = planAdvice(task, current[task.id]); return <div title={`${advice.text} · ${advice.detail} · ${advice.time}`}><div className="ads-plan-advice-summary">{advice.text}</div><small>{advice.detail}</small></div>; } },
    ]}/>
    <Drawer title="投放计划详情" placement="right" size="min(720px, 100vw)" open={Boolean(selectedTask)} onClose={() => { if (!budgetBusy) setSelectedId(null); }} closable={!budgetBusy} maskClosable={!budgetBusy} keyboard={!budgetBusy} destroyOnHidden>
      {selectedTask && <div className="ads-plan-row-panel">
        <div className="ads-plan-row-panel-heading"><strong>{selectedTask.name}{isLocalExampleAd(selectedTask.id) && <Tag className="ml-2">本地示例</Tag>}</strong></div>
        {draftNameConflict(selectedTask) && <Alert type="warning" showIcon title="名称与真实投放状态不一致" description="计划名称包含仅草稿或不投放，但平台开关显示已启用。请核对原操作记录及预算；页面不会自动修改广告状态。" />}
        {!current[selectedTask.id]?.deliveryError && current[selectedTask.id]?.delivery?.adIssues === true && <Alert type="warning" showIcon title="平台广告存在异常" description={current[selectedTask.id]?.delivery?.issueMessages?.join('；') || '平台未返回具体原因，请核对广告状态。'}/>}
        {auditIssues.length > 0 && <Alert type="warning" showIcon title="平台广告存在异常" description={auditIssues.join('；')}/>}
        <p className="ads-plan-advice-detail"><strong>AI 建议：</strong>{planAdvice(selectedTask, current[selectedTask.id]).text} <small>{planAdvice(selectedTask, current[selectedTask.id]).detail}</small></p>
        {readOnly ? <p>计划预算 {selectedTask.currency} {n(selectedTask.budget)} · 计划日预算 {selectedTask.currency} {n(selectedTask.configuration.dailyBudget)}</p> : !previewMode ? <AdPlanBudgetDialog inline task={selectedTask} onClose={() => setSelectedId(null)} onUpdate={onUpdate} onReadback={() => setRefresh(v => v + 1)} onBusyChange={setBudgetBusy}/> : <p>演示数据仅供查看预算。</p>}
        <Space wrap><Button disabled={budgetBusy} onClick={() => onOpen(selectedTask.id)}>素材配置与投放操作</Button><Button disabled={budgetBusy} onClick={() => onAI(selectedTask.id)}>查看 AI 决策与授权记录</Button></Space>
      </div>}
    </Drawer>
  </section>;
}
