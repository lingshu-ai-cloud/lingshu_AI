import { Alert, Button, Collapse, Descriptions, Empty, Select, Skeleton, Table, Tag } from 'antd';
import { BarChart3, MessageSquareText, RefreshCw, Wallet } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BusinessMetric, DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { overviewData, overviewEntries, type AdReport, type ReportEntry } from '../../lib/adOverview';
import { platformAdsRequest, type PlatformAdTask } from '../../lib/platformAds';
import { loadConnectedSocialPerformance, type ConnectedSocialPerformance } from '../../lib/socialPerformance';
import type { Page } from '../../pageRegistry';
import AccountActivity from '../AccountActivity';
import { SocialPlatformIcon } from '../SocialPlatformIcon';
import LsDataChart, { chartPalette } from '../ui/LsDataChart';
import { buildReviewAccounts, buildReviewContents, retainReviewPerformance, reviewMetric, reviewNumber, reviewSum, type ReviewAccountRow, type ReviewContentRow } from './BusinessDataReview.model';

type Props = {
  data: DigitalEmployeeOverview;
  selectedAccountId?: string;
  onNavigate?: (page: Page) => void;
  onOpenContent?: (taskId?: string, socialContentTaskId?: string) => void;
  onOpenProductionProgress?: (taskId: string, contentItemId: string) => void;
};
const number = (value: number | null | undefined, digits = 0) => reviewNumber(value) === null ? '—' : Number(value).toLocaleString('zh-CN', { maximumFractionDigits: digits });
const timestamp = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '待同步';
const money = (value: number | null | undefined, currency = 'CNY') => reviewNumber(value) === null ? '—' : `${currency} ${number(value, 2)}`;
const statusLabels: Record<string, string> = { planned: '计划中', queued: '排队中', producing: '制作中', running: '执行中', waiting_review: '待验收', completed: '已完成', blocked: '需处理', failed: '失败', cancelled: '已取消', paused: '已暂停', scheduled: '已排期', published: '已发布' };

function readReviewPerformanceWithDeadline(): Promise<ConnectedSocialPerformance> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('账号数据同步超时，已保留上次确认的数据，请稍后重试。')), 20_000);
    loadConnectedSocialPerformance().then(resolve, reject).finally(() => window.clearTimeout(timeout));
  });
}

function MetricStrip({ items }: { items: Array<{ label: string; value: ReactNode; note?: string }> }) {
  return <dl className="grid grid-cols-2 border-y border-border sm:grid-cols-4">{items.map((item, index) => <div key={item.label} className="min-w-0 border-border px-4 py-4 [&:not(:nth-child(2n))]:border-r sm:[&:not(:last-child)]:border-r">
    <dt className="text-xs text-text-secondary">{item.label}</dt><dd className="ls-type-metric mt-1 break-words" style={{ color: chartPalette[index % chartPalette.length] }}>{item.value}</dd>
    {item.note && <p className="mt-1 text-xs text-text-secondary">{item.note}</p>}
  </div>)}</dl>;
}
function SectionHeading({ title, icon, extra }: { title: string; icon: ReactNode; extra?: ReactNode }) {
  return <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-4"><h2 className="ls-type-title-medium flex items-center gap-2">{icon}{title}</h2>{extra}</header>;
}
function AccountIdentity({ account }: { account: { platform: string; label: string } }) {
  return <span className="inline-flex min-w-0 items-center gap-2"><SocialPlatformIcon platform={account.platform} size={18}/><span className="min-w-0 break-words">{account.label}</span></span>;
}
function MetricEvidence({ rows }: { rows: Array<{ label: string; metric?: BusinessMetric }> }) {
  return <Table size="small" rowKey="label" pagination={false} dataSource={rows} columns={[
    { title: '指标', dataIndex: 'label' },
    { title: '数值', key: 'value', align: 'right', render: (_, row) => number(reviewMetric(row.metric)) },
    { title: '数据来源 / 口径', key: 'source', responsive: ['sm'], render: (_, row) => <div className="max-w-lg break-words text-xs text-text-secondary">{row.metric?.source || '未接入'}{row.metric?.note ? ` · ${row.metric.note}` : ''}</div> },
  ]}/>;
}

function PlanContentDetails({ contents, onOpenContent, onOpenProductionProgress }: Pick<Props, 'onOpenContent' | 'onOpenProductionProgress'> & { contents: ReviewContentRow[] }) {
  if (!contents.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该账号当前没有计划内容"/>;
  return <Table<ReviewContentRow> size="small" rowKey="id" dataSource={contents} pagination={contents.length > 8 ? { pageSize: 8, showSizeChanger: false } : false} columns={[
    { title: '内容 / 产品', key: 'content', render: (_, row) => <div className="min-w-0 max-w-xl space-y-1"><p className="font-medium break-words">{row.title}</p><p className="text-xs text-text-secondary">{row.product} · {row.origin === 'weekly_plan' ? '本周计划' : '单项内容'} · {row.date || '待排期'}</p>{row.tags.length > 0 && <p className="text-xs text-primary break-words">{row.tags.map(tag => `#${tag.replace(/^#+/, '')}`).join(' ')}</p>}<p className="text-xs text-text-secondary sm:hidden">{statusLabels[row.status] || row.status} · 结算 {money(row.settledCost)}</p></div> },
    { title: '状态', dataIndex: 'status', responsive: ['sm'], render: (value: string) => <Tag color={value === 'completed' ? 'success' : value === 'blocked' || value === 'failed' ? 'error' : 'default'}>{statusLabels[value] || value}</Tag> },
    { title: '时长', dataIndex: 'duration', align: 'right', responsive: ['lg'], render: (value: number | null) => value === null ? '—' : `${number(value)} 秒` },
    { title: '估算 / 结算', key: 'cost', align: 'right', responsive: ['md'], render: (_, row) => <div className="text-xs"><p>{money(row.estimatedCost)}</p><p className="text-text-secondary">{money(row.settledCost)}</p></div> },
    { title: '详情', key: 'action', width: 76, render: (_, row) => row.taskId && row.executionItemId && onOpenProductionProgress ? <Button type="link" onClick={() => onOpenProductionProgress(row.taskId, row.executionItemId)}>查看</Button> : row.socialContentTaskId && onOpenContent ? <Button type="link" onClick={() => onOpenContent(row.taskId, row.socialContentTaskId)}>查看</Button> : <span className="text-xs text-text-secondary">未启动</span> },
  ]} expandable={{ expandedRowRender: row => <Descriptions size="small" column={1} items={[
    { key: 'caption', label: '发布文案', children: row.caption || '尚未生成发布文案' },
    { key: 'contentId', label: '内容编号', children: row.contentId || row.id },
    { key: 'cost', label: '费用口径', children: '估算用于预算参考；结算仅显示供应商费用回执，未回传不记作 0。' },
  ]}/> }}/>
}

function AccountDetails({ account, ...props }: { account: ReviewAccountRow } & Pick<Props, 'onOpenContent' | 'onOpenProductionProgress'>) {
  return <div className="space-y-4">
    <MetricStrip items={[
      { label: '周计划内容', value: number(account.planned), note: '含尚未进入制作的内容' },
      { label: '周期内已发布', value: account.publicationSampleAvailable ? number(account.published.length) : '—', note: '已读取内容样本' },
      { label: '样本累计播放', value: number(account.views), note: '不是周期新增播放' },
      { label: '样本累计互动', value: number(account.interactions), note: '点赞 + 评论 + 分享' },
    ]}/>
    <Collapse ghost items={[
      { key: 'plans', label: `计划与制作明细 · ${account.contents.length} 条`, children: <PlanContentDetails contents={account.contents} {...props}/> },
      { key: 'published', label: account.publicationSampleAvailable ? `已发布内容表现 · ${account.published.length} 条` : '已发布内容表现 · 待同步', children: <Table size="small" rowKey="id" dataSource={account.published} pagination={account.published.length > 8 ? { pageSize: 8, showSizeChanger: false } : false} columns={[
        { title: '已发布内容', key: 'content', render: (_, row) => <div className="max-w-lg break-words"><p className="font-medium">{row.title}</p><p className="text-xs text-text-secondary">{row.publishedAt.slice(0, 10)}<span className="sm:hidden"> · 播放 {number(row.metrics.views)}</span></p></div> },
        { title: '播放', key: 'views', align: 'right', responsive: ['sm'], render: (_, row) => number(row.metrics.views) },
        { title: '点赞', key: 'likes', align: 'right', responsive: ['md'], render: (_, row) => number(row.metrics.likes) },
        { title: '评论', key: 'comments', align: 'right', responsive: ['sm'], render: (_, row) => number(row.metrics.comments) },
        { title: '分享', key: 'shares', align: 'right', responsive: ['lg'], render: (_, row) => number(row.metrics.shares) },
      ]}/> },
    ]}/>
  </div>;
}

function AdReportDetail({ entry }: { entry: ReportEntry }) {
  const report = entry.report;
  const verified = report && ['provider', 'provider_snapshot'].includes(report.source || '');
  if (!verified) return <Alert type="info" showIcon title={entry.error || report?.reason || '该计划尚无可核验的平台报告'}/>;
  return <div className="space-y-4"><Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
    { key: 'source', label: '来源', children: report.stale || report.source === 'provider_snapshot' ? '历史平台快照 · 非实时' : '平台报告' },
    { key: 'time', label: '回传时间', children: timestamp(report.reportedAt) },
    { key: 'window', label: '报告窗口', children: report.window ? `${report.window.since} — ${report.window.until}` : '平台未返回' },
    { key: 'spend', label: '原报告花费', children: money(report.spend, report.currency) },
    { key: 'clicks', label: '原报告点击', children: number(report.clicks) },
    { key: 'impressions', label: '原报告曝光', children: number(report.impressions) },
  ]}/><Collapse ghost items={[{ key: 'daily', label: `逐日回执 · ${report.daily?.length || 0} 天`, children: <Table size="small" rowKey="date" pagination={{ pageSize: 7, showSizeChanger: false }} dataSource={report.daily || []} columns={[
    { title: '平台日期', dataIndex: 'date' }, { title: `花费 (${report.currency})`, dataIndex: 'spend', align: 'right', render: (value: number | null) => number(value, 2) },
    { title: '曝光', dataIndex: 'impressions', align: 'right', responsive: ['sm'], render: (value: number | null) => number(value) },
    { title: '点击', dataIndex: 'clicks', align: 'right', render: (value: number | null) => number(value) },
  ]}/> }]}/></div>;
}

function AdvertisingDetails({ startsAt, endsAt, onNavigate }: { startsAt: string; endsAt: string; onNavigate?: Props['onNavigate'] }) {
  const [tasks, setTasks] = useState<PlatformAdTask[]>([]);
  const [entries, setEntries] = useState<ReportEntry[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [currency, setCurrency] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError('');
    void (async () => {
      try {
        const response = await platformAdsRequest<{ items: PlatformAdTask[] }>('/tasks', { signal: controller.signal });
        if (controller.signal.aborted) return;
        setTasks(response.items);
        for (let offset = 0; offset < response.items.length; offset += 3) {
          const next = await Promise.all(response.items.slice(offset, offset + 3).map(async (task): Promise<ReportEntry> => {
            try { return { ...task, report: await platformAdsRequest<AdReport>(`/tasks/${encodeURIComponent(task.id)}/metrics`, { signal: controller.signal }) } satisfies ReportEntry; }
            catch (cause) { return { ...task, error: cause instanceof Error ? cause.message : '报告读取失败' } satisfies ReportEntry; }
          }));
          if (controller.signal.aborted) return;
          setEntries(previous => {
            const byId = new Map(previous.map(entry => [entry.id, entry]));
            for (const entry of next) byId.set(entry.id, entry.error && byId.get(entry.id)?.report ? { ...byId.get(entry.id)!, error: entry.error } : entry);
            return [...byId.values()];
          });
        }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '投流报告读取失败'); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => controller.abort();
  }, [revision]);
  const currencies = [...new Set(tasks.map(task => task.currency))];
  const chosen = currencies.includes(currency as PlatformAdTask['currency']) ? currency : currencies[0] || 'CNY';
  const scoped = overviewEntries(tasks, entries);
  const aggregate = overviewData(scoped, chosen, startsAt, endsAt);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><Select aria-label="投流统计币种" value={chosen} onChange={setCurrency} options={(currencies.length ? currencies : ['CNY']).map(value => ({ value, label: value }))}/><Tag>{aggregate.usable.length}/{aggregate.selected.length} 个计划有报告</Tag></div><Button loading={busy} icon={<RefreshCw size={14}/>} onClick={() => setRevision(value => value + 1)}>刷新报告</Button></div>
    {error && <Alert type="warning" showIcon title={error} description="已保留最后一次成功读取的数据。"/>}
    {busy && !tasks.length ? <Skeleton paragraph={{ rows: 3 }}/> : !tasks.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有可读取的投放计划"><Button onClick={() => onNavigate?.('adsPlans')}>查看投放计划</Button></Empty> : <>
      <MetricStrip items={[
        { label: '周期花费小计', value: money(aggregate.spend, chosen) }, { label: '周期曝光', value: number(aggregate.impressions) },
        { label: '周期点击', value: number(aggregate.clicks) }, { label: '点击率', value: aggregate.impressions && aggregate.clicks !== null ? `${number(aggregate.clicks / aggregate.impressions * 100, 2)}%` : '—' },
      ]}/>
      <p className="text-xs text-text-secondary">{startsAt} — {endsAt} · 平台报告日期。{aggregate.stale ? '包含历史快照；' : ''}{aggregate.complete ? '当前周期报告完整。' : '仅统计已返回的数据，缺失日期不补零。'} 计划可能映射同一广告资源，小计不作为账号总账；未建立广告归因，不计算询盘成本或 ROAS。</p>
      <div className="grid gap-4 xl:grid-cols-2"><LsDataChart title="每日投流花费" kind="line" unit={chosen} labels={aggregate.daily.map(item => item.date)} series={[{ label: '平台回传花费', values: aggregate.daily.map(item => item.spend) }]} height={220}/><LsDataChart title="每日曝光与点击" kind="line" unit="次" labels={aggregate.daily.map(item => item.date)} series={[{ label: '曝光', values: aggregate.daily.map(item => item.impressions) }, { label: '点击', values: aggregate.daily.map(item => item.clicks) }]} height={220}/></div>
      <Collapse items={aggregate.selected.map(entry => ({ key: entry.id, label: <span className="break-words font-medium">{entry.name}</span>, extra: <Tag color={entry.error ? 'warning' : 'default'}>{entry.error ? '读取异常' : entry.report?.source === 'provider' ? '平台报告' : entry.report?.source === 'provider_snapshot' ? '历史快照' : '待回传'}</Tag>, children: <AdReportDetail entry={entry}/> }))}/>
    </>}
  </div>;
}

export default function BusinessDataReview({ data, selectedAccountId: initialAccountId = '', onNavigate, onOpenContent, onOpenProductionProgress }: Props) {
  const [selectedAccountId, setSelectedAccountId] = useState(initialAccountId);
  useEffect(() => { setSelectedAccountId(initialAccountId); }, [initialAccountId]);
  const [performance, setPerformance] = useState<ConnectedSocialPerformance | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setBusy(true); setError('');
    void readReviewPerformanceWithDeadline().then(result => {
      if (generation.current !== request) return;
      setPerformance(previous => retainReviewPerformance(previous, result));
      if (result.unavailable.length) setError(`${result.unavailable.length} 项账号数据暂不可用，已保留上次确认结果；首次同步仅展示已返回的数据。`);
    }).catch(cause => {
      if (generation.current === request) setError(cause instanceof Error ? cause.message : '账号数据读取失败');
    }).finally(() => { if (generation.current === request) setBusy(false); });
    return () => { generation.current += 1; };
  }, [revision]);
  const snapshot = data.businessSnapshot;
  const context = data.plan?.businessPackage?.operatingContext;
  const startsAt = context?.cycle?.startsAt || data.goal?.startsAt || snapshot?.range.startsAt || '';
  const endsAt = context?.cycle?.endsAt || data.goal?.endsAt || snapshot?.range.endsAt || '';
  const range = startsAt && endsAt ? `${startsAt} — ${endsAt}` : '当前周期';
  const allAccounts = useMemo(() => buildReviewAccounts(data, performance), [data, performance]);
  const accounts = allAccounts.filter(account => !selectedAccountId || account.id === selectedAccountId);
  const contents = useMemo(() => buildReviewContents(data, selectedAccountId), [data, selectedAccountId]);
  const published = accounts.flatMap(account => account.published);
  const sampledViews = reviewSum(published.map(item => item.metrics.views));
  const snapshotViews = !selectedAccountId ? reviewMetric(snapshot?.social.views) : null;
  const accountViews = snapshotViews ?? sampledViews;
  const accountInteractions = !selectedAccountId ? reviewSum([reviewMetric(snapshot?.social.likes), reviewMetric(snapshot?.social.comments), reviewMetric(snapshot?.social.shares), reviewMetric(snapshot?.social.saves)]) : reviewSum(accounts.map(item => item.interactions));
  const productionMetrics = [
    { label: '采集素材', metric: snapshot?.content.collectedItems }, { label: '完成详细分析', metric: snapshot?.content.exactAnalyses },
    { label: '内容项目', metric: snapshot?.content.contentProjects }, { label: '已完成成片', metric: snapshot?.content.completedWorks },
    { label: '已验收成片', metric: snapshot?.content.approvedWorks }, { label: '已排期发布', metric: snapshot?.content.scheduledPosts },
    { label: '已发布', metric: snapshot?.content.publishedPosts }, { label: '发布失败', metric: snapshot?.content.failedPosts },
  ];
  const customerMetrics = [
    { label: '客户总量', metric: snapshot?.customer.total }, { label: '已归因客户', metric: snapshot?.customer.attributed },
    { label: '高意向客户', metric: snapshot?.customer.highIntent }, { label: '已报价客户', metric: snapshot?.customer.quoted },
    { label: '已成交客户', metric: snapshot?.customer.won }, { label: 'AI 自动接待', metric: snapshot?.customer.aiAuto },
    { label: '回复待审核', metric: snapshot?.customer.draftReview }, { label: '需人工处理', metric: snapshot?.customer.humanNeeded },
    { label: '跟进草稿', metric: snapshot?.customer.followupDrafts }, { label: '触达批次', metric: snapshot?.customer.outreachBatches },
    { label: '触达成功', metric: snapshot?.customer.outreachSent }, { label: '触达失败', metric: snapshot?.customer.outreachFailed },
  ];
  const inquiry = snapshot?.interactionReview;
  const evidence = inquiry?.status === 'available' ? inquiry.breakdown.filter(item => !selectedAccountId || item.accountId === selectedAccountId) : [];
  const evidenceAccountIds = [...new Set(evidence.map(item => item.accountId))];
  const ads = snapshot?.ads;
  const adSpend = ads?.status === 'available' ? ads.spendByCurrency : [];
  const daily = selectedAccountId ? [] : snapshot?.social.dailyTrend || [];
  const topContent = [...published].filter(item => item.metrics.views !== null).sort((left, right) => (right.metrics.views || 0) - (left.metrics.views || 0)).slice(0, 10);

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-text-secondary"><span>{range}</span><Select aria-label="数据复盘账号范围" value={selectedAccountId} onChange={setSelectedAccountId} style={{ width: 208, maxWidth: '100%' }} options={[{ value: '', label: '全部账号' }, ...allAccounts.map(account => ({ value: account.id, label: <AccountIdentity account={account}/> }))]}/><span>更新 {timestamp(snapshot?.generatedAt)}</span></div><Button loading={busy} icon={<RefreshCw size={14}/>} onClick={() => setRevision(value => value + 1)}>同步账号数据</Button></div>
    {(error || Boolean(performance?.unavailable.length)) && <Alert type="warning" showIcon title={error || `${performance?.unavailable.length} 项账号数据未同步，保留可用数据`} action={<Button onClick={() => onNavigate?.('accountManagement')}>检查连接</Button>}/>}

    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-white" aria-label="账号数据">
      <SectionHeading title="账号数据" icon={<BarChart3 size={19} className="text-primary"/>} extra={<span className="text-xs text-text-secondary">{accounts.length} 个账号 · {contents.filter(item => item.origin === 'weekly_plan').length} 条计划内容</span>}/>
      <MetricStrip items={[
        { label: '经营账号', value: accounts.length, note: busy && !performance ? '连接状态读取中' : `${accounts.filter(item => item.connected).length} 个已核验连接` },
        { label: '周期计划内容', value: contents.filter(item => item.origin === 'weekly_plan').length, note: `${contents.filter(item => item.status === 'completed').length} 条制作完成` },
        { label: '播放回传', value: number(accountViews), note: snapshotViews !== null ? '经营快照口径' : '周期发布样本累计值' },
        { label: '互动回传', value: number(accountInteractions), note: '仅汇总平台已回传字段' },
      ]}/>
      <div className="px-4 py-3"><Collapse ghost items={[{ key: 'accounts', label: '查看账号数据详情', children: <div className="space-y-5">
        <div className="grid gap-4 xl:grid-cols-2"><LsDataChart title="播放与互动趋势" kind="line" labels={daily.map(item => item.date)} series={[{ label: '播放', values: daily.map(item => item.views) }, { label: '互动', values: daily.map(item => item.interactions) }]} unit="次" height={230}/><LsDataChart title="内容累计播放 Top 10" kind="bar" horizontal labels={topContent.map(item => item.title)} series={[{ label: '累计播放', values: topContent.map(item => item.metrics.views) }]} unit="次" height={230}/></div>
        {selectedAccountId && <p className="text-xs text-text-secondary">当前接口没有单账号日级快照，不把企业总趋势当作当前账号趋势。</p>}
        <p className="text-xs text-text-secondary">经营快照 / 日级趋势：{snapshot?.range.startsAt || '—'} — {snapshot?.range.endsAt || '—'}。内容表现按 {range} 内发布的内容筛选，每账号最多读取最近 50 条，指标为已读取内容的累计回传值，不等同周期新增；互动仅合计已回传字段。缺失回传显示 —。</p>
        <Collapse items={accounts.map(account => ({ key: account.id, label: <AccountIdentity account={account}/>, extra: <Tag>{account.planned} 条计划</Tag>, children: <AccountDetails account={account} onOpenContent={onOpenContent} onOpenProductionProgress={onOpenProductionProgress}/> }))}/>
        <Collapse ghost items={[
          { key: 'production', label: '内容生产与发布总数据 · 企业范围', children: <MetricEvidence rows={productionMetrics}/> },
          { key: 'monitor', label: '账号监控与评论明细 · 企业范围', children: <AccountActivity embedded/> },
          { key: 'source', label: '统计口径与数据缺口', children: <div className="space-y-2 text-xs text-text-secondary"><p>经营快照：{snapshot?.range.startsAt || '—'} — {snapshot?.range.endsAt || '—'} · {snapshot?.range.timeZone || 'Asia/Shanghai'}。</p><p>计划和制作记录独立于平台播放回传；“制作完成”不代表“发布成功”。</p>{(snapshot?.dataGaps || []).map((gap, index) => <p key={index}>{gap}</p>)}</div> },
        ]}/>
      </div> }]}/></div>
    </section>

    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-white" aria-label="询盘数据">
      <SectionHeading title="询盘数据" icon={<MessageSquareText size={19} className="text-primary"/>} extra={<Tag>企业客户记录</Tag>}/>
      <MetricStrip items={[
        { label: '客户总量', value: number(reviewMetric(snapshot?.customer.total)) },
        { label: '获得询盘', value: number(reviewMetric(snapshot?.content.inquiries)) },
        { label: '高意向客户', value: number(reviewMetric(snapshot?.customer.highIntent)) },
        { label: '成交客户', value: number(reviewMetric(snapshot?.customer.won)) },
      ]}/>
      <div className="px-4 py-3"><Collapse ghost items={[{ key: 'inquiries', label: '查看询盘数据详情', children: <div className="space-y-5">
        <div className="grid gap-4 xl:grid-cols-2"><LsDataChart title="客户经营阶段" kind="bar" horizontal labels={['客户总量', '高意向', '已报价', '已成交']} series={[{ label: '客户数', values: [reviewMetric(snapshot?.customer.total), reviewMetric(snapshot?.customer.highIntent), reviewMetric(snapshot?.customer.quoted), reviewMetric(snapshot?.customer.won)] }]} unit="位" height={230}/><LsDataChart title="接待与人工处理" kind="bar" horizontal labels={['AI 自动接待', '回复待审核', '需人工处理']} series={[{ label: '客户数', values: [reviewMetric(snapshot?.customer.aiAuto), reviewMetric(snapshot?.customer.draftReview), reviewMetric(snapshot?.customer.humanNeeded)] }]} unit="位" height={230}/></div>
        <p className="text-xs text-text-secondary">客户阶段可能重叠，不推算漏斗转化率。企业总数据不随单个社媒账号筛选；下方归因明细{selectedAccountId ? '已按选中账号筛选' : '包含全部账号'}。</p>
        <Collapse items={[
          { key: 'customer', label: '客户、接待与跟进明细', children: <MetricEvidence rows={customerMetrics}/> },
          { key: 'attribution', label: `账号 → 内容归因 · ${evidenceAccountIds.length} 个账号`, children: evidenceAccountIds.length ? <div className="space-y-4"><Collapse ghost items={evidenceAccountIds.map(id => {
            const account = accounts.find(item => item.id === id);
            const rows = evidence.filter(item => item.accountId === id);
            return { key: id, label: account ? <AccountIdentity account={account}/> : id || '待识别账号', extra: <span className="text-xs text-text-secondary">{number(reviewSum(rows.map(item => item.inquiries)))} 条询盘</span>, children: <Table size="small" rowKey={(_, index) => `${id}-${index}`} pagination={false} dataSource={rows} columns={[
              { title: '归因内容', key: 'content', render: (_, row) => <div className="max-w-lg break-words">{contents.find(item => item.contentId === row.contentId)?.title || row.contentId || '账号级归因'}{row.businessDirectionRef && <p className="text-xs text-text-secondary">{row.businessDirectionRef}</p>}</div> },
              { title: '评论', dataIndex: 'comments', align: 'right', responsive: ['sm'] }, { title: '询盘', dataIndex: 'inquiries', align: 'right' }, { title: '有效询盘', dataIndex: 'qualifiedInquiries', align: 'right' },
            ]}/> };
          })}/><p className="text-xs text-text-secondary">未识别来源询盘：{number(inquiry?.unknownSourceInquiries)} · 截止 {timestamp(inquiry?.deadline)}。</p></div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={inquiry?.note || '尚无可核验的账号或内容询盘归因'}/> },
        ]}/>
        <div className="flex justify-end"><Button onClick={() => onNavigate?.('conversion')}>查看客户与会话</Button></div>
      </div> }]}/></div>
    </section>

    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-white" aria-label="投流数据">
      <SectionHeading title="投流数据" icon={<Wallet size={19} className="text-primary"/>} extra={<Tag>{ads?.status === 'available' ? '企业平台费用回执' : '企业投流 · 待接入回执'}</Tag>}/>
      <MetricStrip items={[
        { label: '已回传花费', value: adSpend.length === 1 ? money(adSpend[0].amount, adSpend[0].currency) : adSpend.length > 1 ? `${adSpend.length} 种币种` : '—', note: adSpend.length > 1 ? '不同币种不合并' : '按可核验费用回执' },
        { label: '费用回执记录', value: adSpend.length ? number(reviewSum(adSpend.map(item => item.rows))) : '—' },
        { label: '广告归因询盘', value: '—', note: '未建立广告级归因' },
        { label: '广告回报 ROAS', value: '—', note: '需广告归因收入' },
      ]}/>
      <div className="px-4 py-3"><Collapse ghost items={[{ key: 'ads', label: '查看投流数据详情', children: <div className="space-y-4">
        <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
          { key: 'source', label: '数据来源', children: ads?.source || '未接入' }, { key: 'time', label: '最近回执', children: timestamp(ads?.latestReportedAt) },
          ...adSpend.map(item => ({ key: item.currency, label: `${item.currency} 费用回执`, children: money(item.amount, item.currency) })),
        ]}/>
        {ads?.note && <p className="text-xs text-text-secondary">{ads.note}</p>}
        <AdvertisingDetails startsAt={startsAt} endsAt={endsAt} onNavigate={onNavigate}/>
      </div> }]}/></div>
    </section>
  </div>;
}
