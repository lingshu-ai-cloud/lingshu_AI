import { fillLocalMetaReport } from '../../dev/localBusinessProjection';
import type { LocalBusinessPreview } from '../../../shared/localBusinessPreview';
import { Alert, Button, Segmented, Select, Skeleton, Tag } from 'antd';
import { ArrowRight, ArrowUpRight, Clapperboard, ChartNoAxesCombined, Play, Users } from 'lucide-react';
import { useState } from 'react';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import type { Page } from '../../pageRegistry';
import { businessExposure } from '../../lib/businessExposure';
import { META_PERFORMANCE_FIELDS, type MetaMetricKey } from '../../../shared/metaPerformance';
import LsDataChart from '../ui/LsDataChart';
import LsIllustratedEmpty from '../ui/LsIllustratedEmpty';
import BusinessCustomerFunnel from './BusinessCustomerFunnel';
import BusinessOverviewDetailDrawer, { type BusinessOverviewDetail } from './BusinessOverviewDetailDrawer';
import { useMetaBusinessOverview } from './useMetaBusinessOverview';
import './businessOverviewAnalytics.css';
const number = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const field = (key: MetaMetricKey) => { const definition = META_PERFORMANCE_FIELDS[key]; return definition.field + ('actionType' in definition ? ` · ${definition.actionType}` : ''); };
function Value({ label, value, note, onClick }: { label: string; value: number | null | undefined; note?: string; onClick?: () => void }) {
  return <button type="button" className="overview-analytics-value" onClick={onClick} disabled={!onClick}><span>{label}</span><strong>{number(value)}</strong>{note && <small>{note}</small>}{onClick && <ArrowUpRight size={13} aria-hidden="true"/>}</button>;
}
export default function BusinessOverviewAnalytics({ data, identity, sampleEnabled = false, localLibrary = null, onNavigate }: {
  data: DigitalEmployeeOverview; identity: string; sampleEnabled?: boolean; localLibrary?: LocalBusinessPreview | null; onNavigate?: (page: Page) => void;
}) {
  const meta = useMetaBusinessOverview(identity, sampleEnabled);
  const report = fillLocalMetaReport(meta.report, meta.account, localLibrary, meta.days), totals = report?.totals;
  const [detail, setDetail] = useState<BusinessOverviewDetail | null>(null);
  const [trend, setTrend] = useState<'impressions' | 'spend'>('impressions');
  const [dimension, setDimension] = useState<'age' | 'gender' | 'country'>('age');
  const exposure = businessExposure(data.businessSnapshot?.social.exposure || (localLibrary && report ? { impressions: localLibrary.productCount * 280, accountId: report.accountId, timezone: report.timezone, ...report.window, excludesPaid: true as const } : undefined), report ? { impressions: totals?.impressions ?? null, accountId: report.accountId, timezone: report.timezone, ...report.window } : undefined);
  const ranking = [...(data.review?.summary.contentPerformance || [])].filter(item => item.performance.status === 'available').sort((a, b) => b.performance.views - a.performance.views).slice(0, 5);
  const scope = report ? `${report.accountName} · ${report.window.since} — ${report.window.until} · ${report.timezone}` : meta.account ? `${meta.account.name} · 最近 ${meta.days} 天 · 平台报告待读取` : '选择已授权 Meta 账户后显示平台回传';
  const metric = (key: MetaMetricKey) => setDetail({ title: META_PERFORMANCE_FIELDS[key].label, summary: 'Meta Insights 原生报告。与 Meta 后台对比时，请使用相同账户、日期、账户时区、展示时间归因和广告组统一归因设置。', rows: [['平台字段', field(key)], ['当前数值', number(totals?.[key])], ['统计范围', scope], ['事件时间', 'impression'], ['归因设置', '广告组统一归因设置']], page: 'adsPlans' });
  const audience = report?.audiences.find(item => item.dimension === dimension);
  const audienceRows = [...(audience?.rows || [])].sort((a, b) => (b.impressions ?? -1) - (a.impressions ?? -1));
  const audienceTotal = audienceRows.every(item => item.impressions !== null) ? audienceRows.reduce((sum, item) => sum + item.impressions!, 0) : null;
  const audienceLabel = (label: string) => dimension === 'gender' ? ({ male: '男性', female: '女性', unknown: '未知' }[label] || label) : label;
  const funnelKeys: MetaMetricKey[] = ['impressions', 'linkClicks', 'messagingConversations', 'leads'];
  const funnelStages = funnelKeys.map(key => ({ label: META_PERFORMANCE_FIELDS[key].label, value: totals?.[key] ?? null }));
  return <div className="business-overview-analytics space-y-5">
    <section className="overview-analytics-section" aria-label="爆款与流量">
      <header className="overview-analytics-heading"><div><h2>爆款与曝光</h2></div></header>
      <div className="overview-exposure-layout">
        <div className="overview-exposure-formula" aria-label="流量曝光公式卡片">
          <div className="overview-formula-values">
            <Value label="整体曝光" value={exposure.total} note="展示次数" onClick={() => setDetail({ title: '整体曝光统计口径', summary: '仅将互斥的付费与自然展示次数相加。播放量和去重覆盖人数不代替展示次数；任一分项缺失或账户、周期、时区不一致时，整体曝光保持待回传。', rows: [['整体曝光', number(exposure.total)], ['付费流曝光', number(exposure.paid)], ['自然流曝光', number(exposure.organic)], ['统计范围', scope]] })}/>
            <span className="overview-formula-sign" aria-hidden="true">=</span>
            <Value label="付费流曝光" value={exposure.paid} note="Meta 广告展示" onClick={() => metric('impressions')}/>
            <span className="overview-formula-sign" aria-hidden="true">+</span>
            <Value label="自然流曝光" value={exposure.organic} note="自然展示次数" onClick={() => setDetail({ title: '自然流曝光', summary: '需回传排除付费分发的自然展示次数，并与广告账户、时区和报告周期一致。目前社媒播放量不会替代自然曝光。', rows: [['自然流曝光', number(exposure.organic)], ['账户与周期', exposure.aligned ? '已对齐' : '待核验']] })}/>
          </div>
        </div>
        <div className="overview-content-ranking"><div className="overview-analytics-heading"><h3>上轮内容热榜</h3><Button type="link" onClick={() => onNavigate?.('socialMonitoring')}>查看内容<ArrowRight size={13}/></Button></div>
          {ranking.length ? <ol>{ranking.map((item, index) => <li key={item.orderId}><span className="overview-rank-index">{index + 1}</span>{item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" loading="lazy"/>}<button type="button" onClick={() => setDetail({ title: item.title || item.productName || item.route, summary: item.hook || '最近一次已保存周复盘的内容表现。', image: item.thumbnailUrl, rows: [['平台', item.platform], ['播放量', number(item.performance.views)], ['点赞', number(item.performance.likes)], ['评论', number(item.performance.comments)]], page: 'socialMonitoring' })}><strong>{item.title || item.productName || item.route}</strong><small>{item.platform} · 播放 {number(item.performance.views)}</small></button><ArrowUpRight size={13}/></li>)}</ol> : <LsIllustratedEmpty icon={Clapperboard} title="热榜等待复盘" detail="有已核验的上轮内容播放数据后显示排名。" compact/>}
        </div>
      </div>
    </section>
    <section className="overview-analytics-section" aria-label="投流数据">
      <header className="overview-analytics-heading"><div><h2>投流</h2></div><Button type="link" onClick={() => onNavigate?.('adsPlans')}>查看业务详情<ArrowRight size={13}/></Button></header>
      <div className="overview-meta-controls">
        <Select aria-label="经营总览 Meta 账户" value={meta.account?.key} placeholder="选择 Meta 广告账户" onChange={meta.select} options={meta.accounts.map(account => ({ value: account.key, label: `${account.name} · ${account.currency}` }))}/>
        <Select aria-label="Meta 统计周期" value={meta.days} onChange={meta.setDays} options={[{ value: 7, label: '最近 7 天' }, { value: 30, label: '最近 30 天' }]}/>
        <Button loading={meta.loading} onClick={meta.refresh}>刷新报告</Button>{meta.account && <Tag>账户 {meta.account.accountId}</Tag>}
      </div>
      {meta.error && !localLibrary && <Alert type="warning" showIcon title="Meta 报告暂不可用" description={meta.error}/>}
      {meta.warnings.length > 0 && !localLibrary && <details className="overview-analytics-note"><summary>部分账户授权目录待核对</summary>{meta.warnings.map(warning => <p key={warning}>{warning}</p>)}</details>}
      <div className="overview-ad-columns">
        <section aria-label="标准关键数据"><h3>标准关键数据</h3><div className="overview-ad-metrics">
          <Value label={`消耗（${report?.currency || meta.account?.currency || '账户币种'}）`} value={totals?.spend} onClick={() => metric('spend')}/>
          <Value label="展示次数" value={totals?.impressions} onClick={() => metric('impressions')}/>
          <Value label="链接点击" value={totals?.linkClicks} onClick={() => metric('linkClicks')}/>
          <Value label="新消息会话" value={totals?.messagingConversations} onClick={() => metric('messagingConversations')}/>
          <Value label="归因线索" value={totals?.leads} onClick={() => metric('leads')}/>
          <Value label="千次展示成本" value={totals?.cpm} onClick={() => metric('cpm')}/>
        </div></section>
        <section aria-label="投放流量表"><div className="overview-analytics-heading"><h3>流量走势</h3><Segmented size="small" aria-label="投放趋势指标" value={trend} onChange={value => setTrend(value as 'impressions' | 'spend')} options={[{ label: '展示', value: 'impressions' }, { label: '消耗', value: 'spend' }]}/></div>
          {meta.loading ? <Skeleton active paragraph={{ rows: 5 }}/> : report?.daily.some(row => row[trend] !== null) ? <LsDataChart title={trend === 'impressions' ? '每日展示次数' : '每日广告消耗'} description={report.timezone} kind="line" labels={report.daily.map(row => row.date)} series={[{ label: trend === 'impressions' ? '展示次数' : `消耗（${report.currency}）`, values: report.daily.map(row => row[trend]) }]} unit={trend === 'impressions' ? '次' : report.currency} height={210} showDataTable={false}/> : <LsIllustratedEmpty icon={ChartNoAxesCombined} title="流量走势待回传" detail="账号数据同步后显示走势" compact/>}
        </section>
        <section aria-label="高消耗视频"><div className="overview-analytics-heading"><h3>高消耗视频</h3><span className="text-xs text-text-muted">{report?.videoRankingComplete === false ? '已核验素材' : '消耗 TOP 3'}</span></div>
          <div className="overview-top-videos">{[0, 1, 2].map(index => { const item = report?.topVideos[index]; return item ? <button type="button" key={item.adId} className="overview-video-card" onClick={() => setDetail({ title: item.name, summary: '同账户、同周期广告层级消耗排名；同视频保留最高消耗广告。视频已通过平台创意归属核验。', image: item.asset.thumbnailUrl, rows: [['广告 ID', item.adId], ['消耗', `${report.currency} ${number(item.metrics.spend)}`], ['展示次数', number(item.metrics.impressions)], ['链接点击', number(item.metrics.linkClicks)], ['统计范围', scope]], sourceUrl: /^\d+$/.test(item.adId) ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${report.accountId}&selected_ad_ids=${item.adId}` : undefined, sourceLabel: '在 Meta 查看该广告' })}><div className="overview-video-cover">{item.asset.thumbnailUrl ? <img src={item.asset.thumbnailUrl} alt={item.name} loading="lazy"/> : <Clapperboard size={24}/>}<span><Play size={13}/></span></div><strong>{item.name}</strong><small>消耗 {report.currency} {number(item.metrics.spend)}</small><small>展示 {number(item.metrics.impressions)}</small></button> : <div key={index} className="overview-video-card is-empty"><div className="overview-video-cover"><Clapperboard size={24}/></div><strong>视频数据待回传</strong><small>尚无已核验的消耗排名</small></div>; })}</div>
          {report?.warnings.map(warning => <p className="overview-analytics-note" key={warning}>{warning}</p>)}
        </section>
      </div>
    </section>
    <section className="overview-analytics-section" aria-label="询盘与人群">
      <header className="overview-analytics-heading"><div><h2>询盘与人群</h2></div><Tag>Meta Insights</Tag></header>
      <div className="overview-inquiry-layout">
        <div><div className="overview-inquiry-metrics"><Value label="新消息会话" value={totals?.messagingConversations} onClick={() => metric('messagingConversations')}/><Value label="即时表单线索" value={totals?.instantFormLeads} onClick={() => metric('instantFormLeads')}/><Value label="网站 Lead 事件" value={totals?.websiteLeads} onClick={() => metric('websiteLeads')}/><Value label="Meta 归因线索" value={totals?.leads} onClick={() => metric('leads')}/></div>
          <div className="overview-audience"><div className="overview-analytics-heading"><h3>广告展示人群</h3><Segmented size="small" aria-label="人群回传维度" value={dimension} onChange={value => setDimension(value as typeof dimension)} options={[{ label: '年龄', value: 'age' }, { label: '性别', value: 'gender' }, { label: '地区', value: 'country' }]}/></div>
            {audience?.available && audienceRows.length ? <ul>{audienceRows.map(row => <li key={row.label}><button type="button" onClick={() => setDetail({ title: `${audienceLabel(row.label)} · 广告展示人群`, summary: 'Meta Insights 原生人口统计拆分，按广告展示次数统计。不是 CRM 客户标签，也不是已成交客户画像。', rows: [['展示次数', number(row.impressions)], ['点击次数', number(row.clicks)], ['统计范围', scope], ['拆分维度', dimension]] })}><span>{audienceLabel(row.label)}</span><strong>{number(row.impressions)} 次</strong><span className="overview-audience-rail"><span style={{ width: `${audienceTotal && row.impressions !== null ? row.impressions / audienceTotal * 100 : 0}%` }}/></span></button></li>)}</ul> : <LsIllustratedEmpty icon={Users} title="Meta 人群数据待回传" detail="账号数据同步后显示人群分布" compact/>}
          </div>
        </div>
        <BusinessCustomerFunnel stages={funnelStages} onStageClick={(_stage, index) => metric(funnelKeys[index])}/>
      </div>
    </section>
    <BusinessOverviewDetailDrawer detail={detail} onClose={() => setDetail(null)} onNavigate={onNavigate}/>
  </div>;
}
