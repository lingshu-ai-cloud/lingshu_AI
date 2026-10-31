import { useLocalBusinessPreview } from '../../dev/useLocalBusinessPreview';
import { fillLocalBusinessOverview } from '../../dev/localBusinessProjection';
import { LocalBusinessWeek, LocalBusinessInterpretation } from '../../dev/LocalBusinessWeek';
import BusinessOverviewAnalytics from './BusinessOverviewAnalytics';
import './businessOverview.css';
import { Button, Tag } from 'antd';
import { ArrowRight, ArrowUpRight, ChartNoAxesCombined, Hash, Megaphone, RefreshCcw } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { authHeader, AUTH_TOKEN_CHANGED_EVENT } from '../../lib/auth';
import { customerOverview, observedMetric, todayOverview, beijingDay } from '../../lib/businessOverviewPresentation';
import { useCustomers } from '../../hooks/useCustomers';
import type { Page } from '../../pageRegistry';
import BusinessHealthOverview from './BusinessHealthOverview';
import LsDataChart from '../ui/LsDataChart';
import LsIllustratedEmpty from '../ui/LsIllustratedEmpty';
import { businessOverviewSample, isBusinessOverviewSampleEnabled } from '../../dev/businessOverviewSample';
import BusinessOverviewDetailDrawer, { type BusinessOverviewDetail } from './BusinessOverviewDetailDrawer';
import { SocialPlatformIcon } from '../SocialPlatformIcon';

const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const stamp = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN') : '等待回传';
const sourceLink = (value: string) => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
};

function Metric({ label, value, onOpen }: { label: string; value: number | null | undefined; note?: string; onOpen?: () => void }) {
  return <div className={`relative min-w-0 rounded-xl border border-border bg-surface px-4 py-3 ${onOpen ? 'transition-colors hover:border-accent/40 hover:bg-surface-2' : ''}`}>
    <dt className="text-xs text-text-secondary">{label}</dt>
    <dd className="mt-2 text-2xl font-semibold tabular-nums text-text-primary">{number(value)}</dd>
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

function OverviewContent({ data, onRefresh, onNavigate, onOpenAccountHealth, weeklyPlan, interpretation, identity }: {
  data: DigitalEmployeeOverview; onRefresh: () => void; onNavigate?: (page: Page) => void;
  onOpenAccountHealth: () => void; weeklyPlan: ReactNode; interpretation: ReactNode; identity: string;
}) {
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<BusinessOverviewDetail | null>(null);
  const sampleEnabled = isBusinessOverviewSampleEnabled();
  const sample = useMemo(() => sampleEnabled ? businessOverviewSample(data) : null, [data, revision, sampleEnabled]);
  const localLibrary = useLocalBusinessPreview(identity);
  const displayData = useMemo(() => fillLocalBusinessOverview(sample?.displayData || data, localLibrary), [sample, data, localLibrary]);
  const customers = useCustomers(revision, false);
  const snapshot = displayData.businessSnapshot;
  const now = new Date();
  const day = beijingDay(now);
  const customerReady = sampleEnabled || (!(customers.loading && customers.customers.length === 0) && !(customers.error && customers.customers.length === 0));
  const today = sample?.today || todayOverview(displayData, customerReady ? customers.customers : [], now);
  const customer = sample?.customer || customerOverview(customers.customers, day);
  const trends = snapshot?.social.dailyTrend.slice(-7) || [];
  const platforms = snapshot?.social.platformBreakdown.filter(item => item.status === 'available' && item.views !== null).slice(0, 5) || [];
  const hasTrend = trends.some(item => item.views !== null || item.interactions !== null);
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
  const refresh = () => { setRevision(value => value + 1); if (!sampleEnabled) onRefresh(); };
  const showMetric = (title: string, value: number | null | undefined, summary: string, rows: Array<[string, string]>, page?: Page) => setDetail({
    title, summary, rows: [['当前展示', number(value)], ...rows], preview: Boolean(sample), page: sample ? undefined : page,
  });
  const trendRows = (key: 'views' | 'interactions') => trends.map(item => [item.date, `${number(item[key])} 次`] as [string, string]);
  const funnelLabels = ['客户进线', '主动触达', '意图识别', '智能报价', '二次触达'];
  return <div className="mx-auto w-full max-w-[1440px] space-y-5" aria-label="经营数据总览">
    <section className="business-overview-summary min-w-0 overflow-hidden rounded-2xl border border-border bg-surface" aria-label="周经营计划与今日经营概览">
      <div aria-label="当前周计划">{localLibrary && !data.goal ? <LocalBusinessWeek library={localLibrary}/> : weeklyPlan}</div>
      <div className="grid min-w-0 border-t border-border xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.72fr)]">
      <section className="business-overview-today min-w-0 p-4 sm:p-6" aria-labelledby="today-business-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="flex items-center gap-2"><h2 id="today-business-title" className="text-lg font-semibold text-text-primary">今日实时数据</h2>{sample && <Tag color="processing">界面预览</Tag>}</div><p className="mt-2 text-sm text-text-secondary">北京时间 {day} · {sample ? '预览时间' : '最近同步'} {stamp(snapshot?.generatedAt)}</p></div>
          <Button icon={<RefreshCcw size={14}/>} onClick={refresh}>{sample ? '更新预览' : '刷新'}</Button>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Metric label="今日播放" value={today.views} note="内容被看到" onOpen={() => showMetric('今日播放', today.views, '按北京时间统计当天内容播放；下方列出最近 7 日的同口径变化。', trendRows('views'), 'socialMonitoring')}/>
          <Metric label="今日互动" value={today.interactions} note="内容获反馈" onOpen={() => showMetric('今日互动', today.interactions, '按北京时间统计当天内容获得的互动。', trendRows('interactions'), 'socialMonitoring')}/>
          <Metric label="今日客户进线" value={customerReady ? today.inbound : null} note="买家发来消息" onOpen={() => showMetric('今日客户进线', customerReady ? today.inbound : null, '来自客服侧当日新进线客户。', [['累计客户进线', number(customerReady ? customer.inbound : null)], ['已报价客户', number(customerReady ? customer.quoted : null)]], 'conversion')}/>
          <Metric label="今日主动触达" value={customerReady ? today.outreach : null} note="发送已有回执" onOpen={() => showMetric('今日主动触达', customerReady ? today.outreach : null, '查看主动触达在客户承接流程中的位置。', [['承接环节人数', number(customerReady ? customer.funnel[1] : null)], ['二次触达人数', number(customerReady ? customer.funnel[4] : null)]], 'conversion')}/>
        </dl>
        <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(230px,0.85fr)]">
          <div className="min-w-0">{hasTrend ? <><LsDataChart title="近 7 日播放与互动" description={sample ? '界面预览 · 最近 7 日' : '最近 7 日'} kind="line" labels={trends.map(item => item.date)} series={[{ label: '播放', values: trends.map(item => item.views) }, { label: '互动', values: trends.map(item => item.interactions) }]} unit="次" height={160} showDataTable={false}/><Button type="link" size="small" onClick={() => setDetail({ title: '近 7 日播放与互动', summary: '每日播放与互动完整数值。', rows: trends.flatMap(item => [[`${item.date} · 播放`, `${number(item.views)} 次`], [`${item.date} · 互动`, `${number(item.interactions)} 次`]]), preview: Boolean(sample), page: sample ? undefined : 'socialMonitoring' })}>查看每日数据</Button></> : <><h3 className="mb-2 text-sm font-semibold text-text-primary">近 7 日播放与互动</h3><LsIllustratedEmpty icon={ChartNoAxesCombined} title="趋势等待回传" detail="连接社媒账号后显示趋势"/></>}</div>
          <div className="min-w-0">{platforms.length ? <><LsDataChart title="平台播放分布" description={sample ? '界面预览 · 四个平台' : '各平台播放'} kind="bar" horizontal labels={platforms.map(item => item.platform)} series={[{ label: '播放', values: platforms.map(item => item.views) }]} unit="次" height={160} showDataTable={false}/><Button type="link" size="small" onClick={() => setDetail({ title: '平台播放分布', summary: '按已展示的平台逐一比较播放贡献。', rows: platforms.map(item => [item.platform, `${number(item.views)} 次`]), preview: Boolean(sample), page: sample ? undefined : 'socialMonitoring' })}>查看平台明细</Button></> : <><h3 className="mb-2 text-sm font-semibold text-text-primary">平台播放分布</h3><LsIllustratedEmpty icon={Megaphone} title="平台表现待读取" detail="账号数据同步后显示分布"/></>}</div>
        </div>
        <div className="mt-5" aria-label="今日数据经营解读">{localLibrary && !data.goal ? <LocalBusinessInterpretation library={localLibrary}/> : interpretation}</div>
      </section>
      <div className="grid min-w-0 content-start border-t border-border xl:border-l xl:border-t-0">
        <div className="min-w-0 [&_section]:border-0 [&_section]:rounded-none"><BusinessHealthOverview displayCompanyName={localLibrary?.companyName} scoreOnly data={localLibrary && displayData.config ? { ...displayData, config: { ...displayData.config, companyName: localLibrary.companyName } } : displayData} previewScore={sample?.score || (localLibrary ? businessOverviewSample(displayData).score : undefined)} onOpenAccountHealth={onOpenAccountHealth}/></div>
        <section className="min-w-0 border-t border-border p-4 sm:p-5" aria-labelledby="business-topics-title">
          <div className="flex items-center justify-between gap-2"><div><h2 id="business-topics-title" className="text-base font-semibold text-text-primary">热门话题</h2><p className="mt-1 text-xs text-text-secondary">{sample ? '三个平台的最新热议方向' : `已发现 ${topics.length} 个平台的最新话题`}</p></div><Tag>{sample ? '界面预览' : '可追溯来源'}</Tag></div>
          {topics.length ? <ul className="mt-3 divide-y divide-border">{topics.map(topic => <li key={topic.id}>
            <button type="button" aria-haspopup="dialog" aria-label={`查看${topic.platform}话题：${topic.title}`} onClick={() => setDetail({ title: topic.title, summary: topic.summary, rows: [['平台', topic.platform], ['发现时间', stamp(topic.observedAt)], ['讨论标签', topic.tags.join(' · ') || '—']], preview: Boolean(sample), image: topic.thumbnailUrl, sourceUrl: sourceLink(topic.sourceUrl), sourceLabel: sample ? '查看参考内容' : '查看原始来源' })} className="group flex w-full min-w-0 gap-3 rounded-lg py-3 text-left outline-none first:pt-0 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent">
              <div className="min-w-0 flex-1"><SocialPlatformIcon platform={topic.platform} size={15}/><p className="mt-1 text-sm font-medium text-text-primary group-hover:text-accent">{topic.title}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-secondary">{topic.summary}</p><p className="mt-1 text-xs text-text-muted">{sample ? '预览时间' : '观察于'} {topic.observedAt ? stamp(topic.observedAt) : '待核验'}</p></div>
              {topic.thumbnailUrl ? <img className="h-16 w-12 shrink-0 rounded-lg object-cover" src={topic.thumbnailUrl} alt="" loading="lazy"/> : <span className="flex h-16 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent"><Hash size={22} aria-hidden="true"/></span>}
            </button>
          </li>)}</ul> : <div className="mt-3"><LsIllustratedEmpty icon={Hash} title="平台话题待发现" detail="有三个平台可追溯讨论来源后，按发现时间展示最新话题。" compact/></div>}
        </section>
      </div>
      </div>
    </section>

    <BusinessOverviewAnalytics data={displayData} identity={identity} sampleEnabled={sampleEnabled} localLibrary={localLibrary} onNavigate={onNavigate}/>
    <BusinessOverviewDetailDrawer detail={detail} onClose={() => setDetail(null)} onNavigate={onNavigate}/>
  </div>;
}
