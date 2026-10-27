import { Alert, Button, Segmented, Skeleton, Tag } from 'antd';
import { ArrowRight, ArrowUpRight, ChartNoAxesCombined, Clapperboard, Hash, Lightbulb, Megaphone, RefreshCcw, Sparkles, Users } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { authHeader, AUTH_TOKEN_CHANGED_EVENT } from '../../lib/auth';
import { customerOverview, observedMetric, todayOverview, beijingDay } from '../../lib/businessOverviewPresentation';
import { useAdPlanNavigation, useAdPlanTasks } from '../../lib/useAdPlanNavigation';
import { useCustomers } from '../../hooks/useCustomers';
import { useAdPlanOperatingData } from '../useAdPlanOperatingData';
import type { PlanOperatingData } from '../useAdPlanOperatingData';
import { planAdvice, planStatusText } from '../../lib/adPlanRow';
import type { Page } from '../../pageRegistry';
import BusinessHealthOverview from './BusinessHealthOverview';
import LsDataChart from '../ui/LsDataChart';
import LsIllustratedEmpty from '../ui/LsIllustratedEmpty';
import { businessOverviewSample, isBusinessOverviewSampleEnabled } from '../../dev/businessOverviewSample';
import BusinessCustomerFunnel from './BusinessCustomerFunnel';
import BusinessOverviewDetailDrawer, { type BusinessOverviewDetail } from './BusinessOverviewDetailDrawer';

const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const stamp = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN') : '等待回传';
const sourceLink = (value: string) => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
};

function Metric({ label, value, note, onOpen }: { label: string; value: number | null | undefined; note?: string; onOpen?: () => void }) {
  return <div className={`relative min-w-0 rounded-xl border border-border bg-surface px-4 py-3 ${onOpen ? 'transition-colors hover:border-accent/40 hover:bg-surface-2' : ''}`}>
    <dt className="text-xs text-text-secondary">{label}</dt>
    <dd className="mt-2 text-2xl font-semibold tabular-nums text-text-primary">{number(value)}</dd>
    {note && <p className="mt-1 text-xs text-text-muted">{note}</p>}
    {onOpen && <button type="button" aria-label={`查看${label}明细`} aria-haspopup="dialog" onClick={onOpen} className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent"><ArrowUpRight size={15} className="absolute right-3 top-3 text-text-muted" aria-hidden="true"/></button>}
  </div>;
}

function SectionHead({ title, detail, page, onNavigate }: { title: string; detail: string; page?: Page; onNavigate?: (page: Page) => void }) {
  return <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
    <div><h2 className="text-lg font-semibold text-text-primary">{title}</h2><p className="mt-1 text-xs text-text-secondary">{detail}</p></div>
    {page && <Button type="link" icon={<ArrowRight size={14}/>} iconPlacement="end" onClick={() => onNavigate?.(page)}>查看业务详情</Button>}
  </header>;
}

export default function BusinessOverviewLanding(props: {
  data: DigitalEmployeeOverview;
  onRefresh: () => void;
  onNavigate?: (page: Page) => void;
  onOpenAccountHealth: () => void;
  weeklyPlan: ReactNode;
  interpretation: ReactNode;
  work: ReactNode;
}) {
  const [identity, setIdentity] = useState(() => authHeader().Authorization || '');
  useEffect(() => {
    const reset = () => setIdentity(authHeader().Authorization || '');
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, reset);
    window.addEventListener('storage', reset);
    return () => { window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, reset); window.removeEventListener('storage', reset); };
  }, []);
  return <OverviewContent key={identity} {...props} identity={identity}/>;
}

function OverviewContent({ data, onRefresh, onNavigate, onOpenAccountHealth, weeklyPlan, interpretation, work, identity }: {
  data: DigitalEmployeeOverview; onRefresh: () => void; onNavigate?: (page: Page) => void;
  onOpenAccountHealth: () => void; weeklyPlan: ReactNode; interpretation: ReactNode; work: ReactNode; identity: string;
}) {
  const [revision, setRevision] = useState(0);
  const [flow, setFlow] = useState<'organic' | 'commercial'>('organic');
  const [detail, setDetail] = useState<BusinessOverviewDetail | null>(null);
  const sampleEnabled = isBusinessOverviewSampleEnabled();
  const sample = useMemo(() => sampleEnabled ? businessOverviewSample(data) : null, [data, revision, sampleEnabled]);
  const displayData = sample?.displayData || data;
  const customers = useCustomers(revision, false);
  const planNavigation = useAdPlanNavigation(sampleEnabled);
  const plans = useAdPlanTasks(identity, sampleEnabled);
  const visiblePlans = useMemo(() => (sample?.adPlans.tasks || plans.items || []).slice(0, 3), [sample, plans.items]);
  const operating = useAdPlanOperatingData(sampleEnabled ? [] : visiblePlans, revision, sampleEnabled);
  const snapshot = displayData.businessSnapshot;
  const now = new Date();
  const day = beijingDay(now);
  const customerReady = sampleEnabled || (!(customers.loading && customers.customers.length === 0) && !(customers.error && customers.customers.length === 0));
  const today = sample?.today || todayOverview(displayData, customerReady ? customers.customers : [], now);
  const customer = sample?.customer || customerOverview(customers.customers, day);
  const trends = snapshot?.social.dailyTrend.slice(-7) || [];
  const platforms = snapshot?.social.platformBreakdown.filter(item => item.status === 'available' && item.views !== null).slice(0, 5) || [];
  const hasTrend = trends.some(item => item.views !== null || item.interactions !== null);
  const rankedContent = [...(displayData.review?.summary.contentPerformance || [])].filter(item => item.performance.status === 'available')
    .sort((a, b) => b.performance.views - a.performance.views).slice(0, 5);
  const ads = snapshot?.ads;
  const adsReady = ads?.status === 'available';
  const adsPerformance = adsReady ? ads.performance : undefined;
  const topicSignals = displayData.industryTrends?.status === 'available' ? [...displayData.industryTrends.signals]
    .filter(topic => sourceLink(topic.sourceUrl))
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt)) : [];
  const topicPlatforms = new Set<string>();
  const topics = topicSignals.filter(topic => {
    const platform = topic.platform.toLowerCase();
    if (topicPlatforms.has(platform)) return false;
    topicPlatforms.add(platform);
    return true;
  }).slice(0, 3);
  const boost = displayData.review?.summary.nextRoundRecommendations?.contentInheritance.paidBoost;
  const operatingItems: Record<string, PlanOperatingData> = sample ? Object.fromEntries(sample.adPlans.entries.map(entry => [entry.id, {
    metrics: {
      currency: entry.report?.currency || 'CNY', reportedAt: entry.report?.reportedAt || snapshot?.generatedAt || '',
      spend: entry.report?.spend ?? null, impressions: entry.report?.impressions ?? null, clicks: entry.report?.clicks ?? null,
      results: null, costPerResult: null, metricLabel: '询盘',
    },
    errors: [], runs: [],
  }])) : operating.items;
  const refresh = () => { setRevision(value => value + 1); if (!sampleEnabled) { plans.retry(); onRefresh(); } };
  const openPlan = (id: string) => { if (sampleEnabled) return; planNavigation.select(id); onNavigate?.('adsPlans'); };
  const showMetric = (title: string, value: number | null | undefined, summary: string, rows: Array<[string, string]>, page?: Page) => setDetail({
    title, summary, rows: [['当前展示', number(value)], ...rows], preview: Boolean(sample), page: sample ? undefined : page,
  });
  const trendRows = (key: 'views' | 'interactions') => trends.map(item => [item.date, `${number(item[key])} 次`] as [string, string]);
  const funnelLabels = ['客户进线', '主动触达', '意图识别', '智能报价', '二次触达'];
  const funnelStages = funnelLabels.map((label, index) => ({ label, value: customerReady ? customer.funnel[index] ?? null : null }));
  const funnelNotes = [
    '本周期进入客服承接目录的客户。', '已有主动触达发送记录的客户。',
    '已识别并记录采购意图的客户。', '已有智能报价发送回执的客户。', '已有后续再次触达记录的客户。',
  ];

  return <div className="mx-auto w-full max-w-[1440px] space-y-5" aria-label="经营数据总览">
    <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-surface" aria-label="周经营计划与今日经营概览">
      <div aria-label="当前周计划">{weeklyPlan}</div>
      <div className="grid min-w-0 border-t border-border xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.72fr)]">
      <section className="min-w-0 p-4 sm:p-6" aria-labelledby="today-business-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="flex items-center gap-2"><h2 id="today-business-title" className="text-lg font-semibold text-text-primary">今日实时数据</h2>{sample && <Tag color="processing">界面预览</Tag>}</div><p className="mt-1 text-xs text-text-secondary">北京时间 {day} · {sample ? '预览时间' : '最近同步'} {stamp(snapshot?.generatedAt)} · {sample ? '仅用于查看界面布局' : '社媒为日级回传，非秒级实时'}</p></div>
          <Button icon={<RefreshCcw size={14}/>} loading={!sample && plans.loading} onClick={refresh}>{sample ? '更新预览' : '刷新'}</Button>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Metric label="今日播放" value={today.views} note="内容被看到" onOpen={() => showMetric('今日播放', today.views, '按北京时间统计当天内容播放；下方列出最近 7 日的同口径变化。', trendRows('views'), 'socialMonitoring')}/>
          <Metric label="今日互动" value={today.interactions} note="内容获反馈" onOpen={() => showMetric('今日互动', today.interactions, '按北京时间统计当天内容获得的互动。', trendRows('interactions'), 'socialMonitoring')}/>
          <Metric label="今日客户进线" value={customerReady ? today.inbound : null} note="买家发来消息" onOpen={() => showMetric('今日客户进线', customerReady ? today.inbound : null, '来自客服侧当日新进线客户。', [['累计客户进线', number(customerReady ? customer.inbound : null)], ['已报价客户', number(customerReady ? customer.quoted : null)]], 'conversion')}/>
          <Metric label="今日主动触达" value={customerReady ? today.outreach : null} note="发送已有回执" onOpen={() => showMetric('今日主动触达', customerReady ? today.outreach : null, '查看主动触达在客户承接流程中的位置。', [['承接环节人数', number(customerReady ? customer.funnel[1] : null)], ['二次触达人数', number(customerReady ? customer.funnel[4] : null)]], 'conversion')}/>
        </dl>
        <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(230px,0.85fr)]">
          <div className="min-w-0">{hasTrend ? <><LsDataChart title="近 7 日播放与互动" description={sample ? '界面预览 · 最近 7 日' : '已有日级回传 · 缺失日期不补零'} kind="line" labels={trends.map(item => item.date)} series={[{ label: '播放', values: trends.map(item => item.views) }, { label: '互动', values: trends.map(item => item.interactions) }]} unit="次" height={215} showDataTable={false}/><Button type="link" size="small" onClick={() => setDetail({ title: '近 7 日播放与互动', summary: '每日播放与互动完整数值。', rows: trends.flatMap(item => [[`${item.date} · 播放`, `${number(item.views)} 次`], [`${item.date} · 互动`, `${number(item.interactions)} 次`]]), preview: Boolean(sample), page: sample ? undefined : 'socialMonitoring' })}>查看每日数据</Button></> : <><h3 className="mb-2 text-sm font-semibold text-text-primary">近 7 日播放与互动</h3><LsIllustratedEmpty icon={ChartNoAxesCombined} title="趋势等待回传" detail="连接社媒账号后，真实日级播放与互动将在这里形成折线。"/></>}</div>
          <div className="min-w-0">{platforms.length ? <><LsDataChart title="平台播放分布" description={sample ? '界面预览 · 四个平台' : '当前快照中已回传的平台'} kind="bar" horizontal labels={platforms.map(item => item.platform)} series={[{ label: '播放', values: platforms.map(item => item.views) }]} unit="次" height={215} showDataTable={false}/><Button type="link" size="small" onClick={() => setDetail({ title: '平台播放分布', summary: '按已展示的平台逐一比较播放贡献。', rows: platforms.map(item => [item.platform, `${number(item.views)} 次`]), preview: Boolean(sample), page: sample ? undefined : 'socialMonitoring' })}>查看平台明细</Button></> : <><h3 className="mb-2 text-sm font-semibold text-text-primary">平台播放分布</h3><LsIllustratedEmpty icon={Megaphone} title="平台表现待读取" detail="有平台播放回传后，在这里比较各平台贡献。"/></>}</div>
        </div>
        <div className="mt-5" aria-label="今日数据经营解读">{interpretation}</div>
      </section>
      <div className="grid min-w-0 content-start border-t border-border xl:border-l xl:border-t-0">
        <div className="min-w-0 [&_section]:border-0 [&_section]:rounded-none"><BusinessHealthOverview scoreOnly data={displayData} previewScore={sample?.score} onOpenAccountHealth={sample ? () => setDetail({ title: '账号分与评估口径', summary: '当前展示 5 项账号健康口径，点击各项分数可对照评分结构。', rows: sample.score.criteria.map(item => [item.label, `${item.score ?? '—'} 分`]), preview: true }) : onOpenAccountHealth}/></div>
        <section className="min-w-0 border-t border-border p-4 sm:p-5" aria-labelledby="business-topics-title">
          <div className="flex items-center justify-between gap-2"><div><h2 id="business-topics-title" className="text-base font-semibold text-text-primary">热门话题</h2><p className="mt-1 text-xs text-text-secondary">{sample ? '三个平台的最新热议方向' : `已发现 ${topics.length} 个平台的最新话题`}</p></div><Tag>{sample ? '界面预览' : '可追溯来源'}</Tag></div>
          {topics.length ? <ul className="mt-3 divide-y divide-border">{topics.map(topic => <li key={topic.id}>
            <button type="button" aria-haspopup="dialog" aria-label={`查看${topic.platform}话题：${topic.title}`} onClick={() => setDetail({ title: topic.title, summary: topic.summary, rows: [['平台', topic.platform], ['发现时间', stamp(topic.observedAt)], ['讨论标签', topic.tags.join(' · ') || '—']], preview: Boolean(sample), image: topic.thumbnailUrl, sourceUrl: sourceLink(topic.sourceUrl), sourceLabel: sample ? '查看参考内容' : '查看原始来源' })} className="group flex w-full min-w-0 gap-3 rounded-lg py-3 text-left outline-none first:pt-0 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent">
              <div className="min-w-0 flex-1"><span className="text-xs font-semibold text-accent">{topic.platform}</span><p className="mt-1 text-sm font-medium text-text-primary group-hover:text-accent">{topic.title}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-secondary">{topic.summary}</p><p className="mt-1 text-xs text-text-muted">{sample ? '预览时间' : '观察于'} {topic.observedAt ? stamp(topic.observedAt) : '待核验'}</p></div>
              {topic.thumbnailUrl ? <img className="h-16 w-12 shrink-0 rounded-lg object-cover" src={topic.thumbnailUrl} alt="" loading="lazy"/> : <span className="flex h-16 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent"><Hash size={22} aria-hidden="true"/></span>}
            </button>
          </li>)}</ul> : <div className="mt-3"><LsIllustratedEmpty icon={Hash} title="平台话题待发现" detail="有三个平台可追溯讨论来源后，按发现时间展示最新话题。" compact/></div>}
        </section>
      </div>
      </div>
    </section>

    <section aria-labelledby="business-ai-title" className="space-y-4">
      <div className="flex items-center gap-2 px-1"><Sparkles size={18} className="text-accent"/><h2 id="business-ai-title" className="text-lg font-semibold text-text-primary">数字员工正在推进的工作</h2></div>
      {work}
    </section>

    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5" aria-label="爆款与流量">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div><h2 className="text-lg font-semibold text-text-primary">爆款与曝光</h2><p className="mt-1 text-xs text-text-secondary">{sample ? '切换查看自然流与商业流的数据布局' : '自然流来自已连接社媒账号；商业流只读取投放内容的平台回传'}</p></div>
        <Segmented aria-label="曝光流量来源" value={flow} onChange={value => setFlow(value as 'organic' | 'commercial')} options={[{ label: '自然流数据', value: 'organic' }, { label: '商业数据', value: 'commercial' }]}/>
      </div>
      {flow === 'organic' ? <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
        <div className="min-w-0"><dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"><Metric label="周期播放" value={observedMetric(snapshot?.social.views)} onOpen={() => showMetric('周期播放', observedMetric(snapshot?.social.views), '本周期自然流播放，不包括投放曝光。', trendRows('views'), 'socialMonitoring')}/><Metric label="周期触达" value={observedMetric(snapshot?.social.reach)} onOpen={() => showMetric('周期触达', observedMetric(snapshot?.social.reach), '本周期自然流触达人数。', [['统计区间', `${snapshot?.range.startsAt || '—'} 至 ${snapshot?.range.endsAt || '—'}`]], 'socialMonitoring')}/><Metric label="周期互动" value={[snapshot?.social.likes, snapshot?.social.comments, snapshot?.social.shares, snapshot?.social.saves].every(item => observedMetric(item) !== null) ? [snapshot?.social.likes, snapshot?.social.comments, snapshot?.social.shares, snapshot?.social.saves].reduce((sum, item) => sum + (observedMetric(item) || 0), 0) : null} onOpen={() => showMetric('周期互动', [snapshot?.social.likes, snapshot?.social.comments, snapshot?.social.shares, snapshot?.social.saves].every(item => observedMetric(item) !== null) ? [snapshot?.social.likes, snapshot?.social.comments, snapshot?.social.shares, snapshot?.social.saves].reduce((sum, item) => sum + (observedMetric(item) || 0), 0) : null, '点赞、评论、分享和收藏的合计。', [['点赞', number(observedMetric(snapshot?.social.likes))], ['评论', number(observedMetric(snapshot?.social.comments))], ['分享', number(observedMetric(snapshot?.social.shares))], ['收藏', number(observedMetric(snapshot?.social.saves))]], 'socialMonitoring')}/></dl>
          <div className="mt-4">{hasTrend ? <><LsDataChart title="自然流趋势" description={sample ? '界面预览 · 最近 7 日' : undefined} kind="line" labels={trends.map(item => item.date)} series={[{ label: '播放', values: trends.map(item => item.views) }, { label: '互动', values: trends.map(item => item.interactions) }]} unit="次" height={225} showDataTable={false}/><Button type="link" size="small" onClick={() => setDetail({ title: '自然流每日趋势', summary: '自然流播放与互动的每日明细。', rows: trends.flatMap(item => [[`${item.date} · 播放`, `${number(item.views)} 次`], [`${item.date} · 互动`, `${number(item.interactions)} 次`]]), preview: Boolean(sample), page: sample ? undefined : 'socialMonitoring' })}>查看每日明细</Button></> : <><h3 className="mb-2 text-sm font-semibold text-text-primary">自然流趋势</h3><LsIllustratedEmpty icon={ChartNoAxesCombined} title="自然流等待回传" detail="有社媒日级数据后显示真实变化，不补零造线。" compact/></>}</div>
        </div>
        <div className="min-w-0 lg:border-l lg:border-border lg:pl-5"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-text-primary">上轮内容播放榜</h3>{!sample && <Button type="link" onClick={() => onNavigate?.('socialMonitoring')}>查看内容</Button>}</div>
          {rankedContent.length ? <ol className="mt-2 divide-y divide-border">{rankedContent.map((item, index) => <li key={item.orderId} className="flex items-center gap-3 py-3">
            <span className="w-5 shrink-0 text-sm font-semibold tabular-nums text-accent">{index + 1}</span>
            {item.thumbnailUrl && <img className="h-12 w-12 shrink-0 rounded-lg object-cover" src={item.thumbnailUrl} alt="" loading="lazy"/>}
            <button type="button" aria-haspopup="dialog" onClick={() => setDetail({ title: item.title || item.productName || item.route, summary: item.hook || '上轮内容表现明细。', rows: [['平台', item.platform], ['播放', number(item.performance.views)], ['点赞', number(item.performance.likes)], ['评论', number(item.performance.comments)], ['分享', number(item.performance.shares)], ['询盘', number(item.performance.leads)]], image: item.thumbnailUrl, preview: Boolean(sample), page: sample ? undefined : 'socialMonitoring' })} className="min-w-0 flex-1 rounded-lg text-left outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent"><p className="line-clamp-2 text-sm text-text-primary">{item.title || item.productName || item.route}</p><p className="mt-1 text-xs text-text-muted">{item.platform} · 复盘播放 {number(item.performance.views)} · 查看明细</p></button>
          </li>)}</ol> : <LsIllustratedEmpty icon={Clapperboard} title="内容榜等待复盘" detail="有真实播放回传的上轮内容会展示在这里。" compact/>}
          <p className="mt-2 text-xs text-text-muted">{sample ? '内容表现样式预览；不对应当前账号的真实排名。' : '榜单来自已保存的最近一次周复盘，不是当前周期实时排名。'}</p>
        </div>
      </div> : <div className="mt-4 space-y-4">
        <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"><Metric label="投放曝光" value={observedMetric(adsPerformance?.impressions)} onOpen={() => showMetric('投放曝光', observedMetric(adsPerformance?.impressions), '仅统计商业投放内容的平台曝光。', [['投放点击', number(observedMetric(adsPerformance?.clicks))], ['平台转化', number(observedMetric(adsPerformance?.conversions))]], 'adsPlans')}/><Metric label="投放点击" value={observedMetric(adsPerformance?.clicks)} onOpen={() => showMetric('投放点击', observedMetric(adsPerformance?.clicks), '仅统计商业投放内容的平台点击。', [['投放曝光', number(observedMetric(adsPerformance?.impressions))], ['平台转化', number(observedMetric(adsPerformance?.conversions))]], 'adsPlans')}/><Metric label="平台转化" value={observedMetric(adsPerformance?.conversions)} onOpen={() => showMetric('平台转化', observedMetric(adsPerformance?.conversions), '平台报告的转化，不等同于客服侧成交。', [['投放点击', number(observedMetric(adsPerformance?.clicks))]], 'adsPlans')}/></dl>
        {[adsPerformance?.impressions, adsPerformance?.clicks, adsPerformance?.conversions].some(item => observedMetric(item) !== null) ? <LsDataChart title="商业流量回传" description={sample ? '界面预览 · 投放曝光、点击与转化' : '当前经营快照的投放曝光、点击与转化；不是自然流播放'} kind="bar" horizontal labels={['曝光', '点击', '转化']} series={[{ label: sample ? '预览指标' : '平台回传', values: [observedMetric(adsPerformance?.impressions), observedMetric(adsPerformance?.clicks), observedMetric(adsPerformance?.conversions)] }]} unit="次" height={200} showDataTable={false}/> : <><h3 className="text-sm font-semibold text-text-primary">商业流量回传</h3><LsIllustratedEmpty icon={Megaphone} title="投放成效等待回传" detail="仅显示投放内容的真实平台回执，不借用自然流数据。" compact/></>}
        <Button type="link" size="small" onClick={() => setDetail({ title: '商业流量明细', summary: '曝光、点击、转化是不同环节，不作为同量纲的趋势推断。', rows: [['曝光', number(observedMetric(adsPerformance?.impressions))], ['点击', number(observedMetric(adsPerformance?.clicks))], ['转化', number(observedMetric(adsPerformance?.conversions))], ['最近更新', stamp(ads?.latestReportedAt)]], preview: Boolean(sample), page: sample ? undefined : 'adsPlans' })}>查看投放明细</Button>
        <p className="text-xs text-text-muted">{sample ? `投放效果布局 · 预览时间 ${stamp(ads?.latestReportedAt)}` : `投流报告最近回传 ${stamp(ads?.latestReportedAt)}。无广告日级序列时不绘制虚构趋势。`}</p>
      </div>}
    </section>

    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5" aria-label="投流数据">
      <SectionHead title="投流" detail={`${sample ? '投放效果布局' : '平台成效与真实计划状态'} · ${sample ? '预览时间' : '最近回传'} ${stamp(ads?.latestReportedAt)}`} page={sample ? undefined : 'adsPlans'} onNavigate={onNavigate}/>
      <div className="mt-4 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(245px,0.31fr)]">
        <div className="min-w-0"><dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"><Metric label="曝光" value={observedMetric(adsPerformance?.impressions)} onOpen={() => showMetric('投流曝光', observedMetric(adsPerformance?.impressions), '当前投放计划的平台曝光汇总。', visiblePlans.map(task => [task.name, number(operatingItems[task.id]?.metrics?.impressions)]), 'adsPlans')}/><Metric label="点击" value={observedMetric(adsPerformance?.clicks)} onOpen={() => showMetric('投流点击', observedMetric(adsPerformance?.clicks), '当前投放计划的平台点击汇总。', visiblePlans.map(task => [task.name, number(operatingItems[task.id]?.metrics?.clicks)]), 'adsPlans')}/><Metric label="转化" value={observedMetric(adsPerformance?.conversions)} onOpen={() => showMetric('投流转化', observedMetric(adsPerformance?.conversions), '平台报告的转化汇总，不等于客服侧成交。', [['投放点击', number(observedMetric(adsPerformance?.clicks))]], 'adsPlans')}/></dl>
          <h3 className="mb-2 mt-5 text-sm font-semibold text-text-primary">投放计划</h3>
          {!sample && plans.error && <Alert type="warning" className="mb-3" title={plans.error}/>}
          {!sample && plans.loading && !plans.items ? <Skeleton active paragraph={{ rows: 3 }}/> : visiblePlans.length ? <div className="divide-y divide-border rounded-xl border border-border">{visiblePlans.map(task => {
            const readback = operatingItems[task.id]; const metrics = readback?.metrics;
            return <div key={task.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-text-primary" title={task.name}>{task.name}</p><p className="mt-1 text-xs text-text-muted">{task.channels.join(' / ')} · {metrics?.reportedAt ? `${sample ? '预览' : '回传'} ${stamp(metrics.reportedAt)}` : '成效待回传'}</p></div><div className="flex items-center gap-2"><Tag>{sample ? '计划进行中' : planStatusText(task, readback)}</Tag><span className="text-xs tabular-nums text-text-secondary">曝光 {number(metrics?.impressions)}</span>{sample ? <Button size="small" onClick={() => setDetail({ title: task.name, summary: '计划成效与观察进度。', rows: [['投放平台', task.channels.join(' / ')], ['曝光', number(metrics?.impressions)], ['点击', number(metrics?.clicks)], ['消耗', `${metrics?.currency || 'CNY'} ${number(metrics?.spend)}`], ['预览时间', stamp(metrics?.reportedAt)]], preview: true })}>查看明细</Button> : <Button size="small" onClick={() => openPlan(task.id)}>查看</Button>}</div></div>;
          })}</div> : <LsIllustratedEmpty icon={Megaphone} title="暂无投放计划" detail="建立投放计划并取得平台回执后展示效果。" compact/>}
          {ads?.spendByCurrency?.length ? <button type="button" aria-haspopup="dialog" onClick={() => setDetail({ title: '投放消耗', summary: '按币种分别展示报告消耗，不跨币种相加。', rows: ads.spendByCurrency.map(item => [item.currency, number(item.amount)] as [string, string]), preview: Boolean(sample), page: sample ? undefined : 'adsPlans' })} className="mt-3 rounded text-left text-xs text-text-secondary outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent">报告消耗：{ads.spendByCurrency.map(item => `${item.currency} ${number(item.amount)}`).join(' · ')}。查看币种明细 <ArrowUpRight size={12} className="inline" aria-hidden="true"/></button> : <p className="mt-3 text-xs text-text-muted">投放消耗暂无可核验回传。</p>}
        </div>
        <aside className="rounded-xl border border-border bg-surface-2 p-4" aria-label="AI 投流建议"><h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Lightbulb size={16} className="text-accent"/>AI 投流建议</h3>
          {visiblePlans.length ? <div className="mt-4 space-y-4">{visiblePlans.slice(0, 2).map((task, index) => { const advice = sample ? { text: index === 0 ? '优先保留高意向人群' : '小幅测试质地类素材', detail: index === 0 ? '当前点击与询盘方向一致，先观察报价承接。' : '按已展示的曝光与点击结构，比较两组素材表现。' } : planAdvice(task, operatingItems[task.id]); return <button type="button" key={task.id} aria-haspopup="dialog" onClick={() => setDetail({ title: advice.text, summary: advice.detail, rows: [['关联计划', task.name], ['曝光', number(operatingItems[task.id]?.metrics?.impressions)], ['点击', number(operatingItems[task.id]?.metrics?.clicks)]], preview: Boolean(sample), page: sample ? undefined : 'adsPlans' })} className="group w-full rounded-lg text-left outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent"><p className="text-xs font-medium text-text-secondary">{task.name}</p><p className="mt-1 text-sm font-medium text-text-primary group-hover:text-accent">{advice.text} <ArrowUpRight size={13} className="inline text-text-muted" aria-hidden="true"/></p><p className="mt-1 text-xs leading-5 text-text-secondary">{advice.detail}</p></button>; })}</div>
            : boost?.status === 'recommended_for_review' ? <p className="mt-3 text-sm leading-6 text-text-secondary">{boost.reason}</p>
              : <p className="mt-3 text-sm leading-6 text-text-secondary">暂无基于真实计划与回执的投流建议。</p>}
          {!sample && <Button className="mt-4" type="link" icon={<ArrowRight size={14}/>} iconPlacement="end" onClick={() => onNavigate?.('adsManaged')}>查看 AI 投手</Button>}
        </aside>
      </div>
    </section>

    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5" aria-label="询盘与人群">
      <SectionHead title="询盘与人群" detail={sample ? '客户承接布局 · 当前展示累计客户数' : '来自客服侧真实客户目录与消息记录 · 当前展示累计客户数'} page={sample ? undefined : 'conversion'} onNavigate={onNavigate}/>
      {!sample && customers.error && <Alert type="warning" className="mt-4" title={customers.error} description="已有同身份记录保留；读取失败不代表真实零值。"/>}
      <div className="mt-4 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1fr)]">
        <div className="min-w-0 rounded-xl border border-border p-4">
          <dl className="grid grid-cols-2 gap-2.5"><Metric label="客户进线" value={customerReady ? customer.inbound : null} onOpen={() => showMetric('客户进线', customerReady ? customer.inbound : null, '进入客服承接目录的累计客户。', [['今日进线', number(customerReady ? today.inbound : null)], ['意图识别', number(customerReady ? customer.funnel[2] : null)]], 'conversion')}/><Metric label="已报价" value={customerReady ? customer.quoted : null} onOpen={() => showMetric('已报价', customerReady ? customer.quoted : null, '已有报价记录的客户数。', [['客户进线', number(customerReady ? customer.inbound : null)], ['已成交', number(customerReady ? customer.won : null)]], 'conversion')}/><Metric label="已成交" value={customerReady ? customer.won : null} onOpen={() => showMetric('已成交', customerReady ? customer.won : null, '已确认成交的客户数。', [['已报价', number(customerReady ? customer.quoted : null)]], 'conversion')}/><Metric label="潜客" value={customerReady ? customer.lead : null} onOpen={() => showMetric('潜客', customerReady ? customer.lead : null, '仍在跟进中的潜在客户。', [['客户进线', number(customerReady ? customer.inbound : null)], ['主动触达', number(customerReady ? customer.funnel[1] : null)]], 'conversion')}/></dl>
          <div className="mt-5 border-t border-border pt-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-text-primary">人群标签</h3><span className="text-xs text-text-muted">点击查看结构</span></div>
            {!sample && customers.loading && !customers.customers.length ? <Skeleton active paragraph={{ rows: 3 }}/> : customerReady && customer.tags.length ? <div className="mt-3 space-y-2">{customer.tags.map(([label, count]) => <button key={label} type="button" aria-haspopup="dialog" aria-label={`查看${label}人群，${count}位客户`} onClick={() => setDetail({ title: `${label}人群`, summary: '同一客户的相同标签只计一次；不同标签可能属于同一客户。', rows: [['标签客户数', `${number(count)} 位`], ['累计客户进线', `${number(customer.inbound)} 位`], ['占进线客户', customer.inbound ? `${(count / customer.inbound * 100).toFixed(1)}%` : '—']], preview: Boolean(sample), page: sample ? undefined : 'conversion' })} className="group block w-full rounded-lg px-2 py-1.5 text-left outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"><span className="flex items-center justify-between gap-2 text-xs"><span className="font-medium text-text-primary">{label}</span><span className="tabular-nums text-text-secondary">{count} 位 <ArrowUpRight size={12} className="inline text-text-muted" aria-hidden="true"/></span></span><span className="mt-1.5 block h-1.5 rounded-full bg-surface-2"><span className="block h-full rounded-full bg-accent/80" style={{ width: `${Math.min(100, customer.inbound ? count / customer.inbound * 100 : 0)}%` }}/></span></button>)}</div> : <LsIllustratedEmpty icon={Users} title={customerReady ? '暂无客户标签' : '客户标签待读取'} detail="真实客户产生标签后在这里呈现人群结构。" compact/>}
            <p className="mt-3 text-xs text-text-muted">{sample ? '人群结构预览；标签可重叠。' : '仅统计真实且可操作的客户；标签可重叠。'}</p>
          </div>
        </div>
        <div className="min-w-0"><BusinessCustomerFunnel stages={funnelStages} description="从上到下呈现客户承接五个环节；点击查看统计口径" onStageClick={(stage, index) => setDetail({ title: stage.label, summary: funnelNotes[index] || '客户承接环节。', rows: [['本环节客户', stage.value === null ? '—' : `${number(stage.value)} 位`], ['客户进线', customerReady ? `${number(customer.inbound)} 位` : '—'], ['统计说明', '各环节有记录的人数，不强制互为子集']], preview: Boolean(sample), page: sample ? undefined : 'conversion' })}/>
          <p className="mt-2 text-xs text-text-muted">{sample ? '客户承接五环节布局预览；具体口径以客服侧正式数据为准。' : '主动触达与二次触达只统计发送成功的消息；智能报价仅统计 AI 发出的报价回执。暂无连续转化率口径。'}</p>
        </div>
      </div>
    </section>
    <BusinessOverviewDetailDrawer detail={detail} onClose={() => setDetail(null)} onNavigate={onNavigate}/>
  </div>;
}
