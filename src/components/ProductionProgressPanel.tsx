import { useState, type ReactNode } from 'react';
import type { BusinessLine, BusinessMetric, ContentPlatform, DigitalEmployeeOverview } from '../lib/digitalEmployees';

type Period = 'week' | 'lastWeek' | 'month' | 'lastMonth';
type Filter = 'all' | 'clone' | 'digital' | 'completed' | 'pending' | 'approved' | 'blocked';
const metricValue = (metric?: BusinessMetric) => metric?.status === 'available' && metric.value !== null ? metric.value.toLocaleString() : '—';
export default function ProductionProgressPanel({ data, businessLine, contentPlatform, onPeriodChange, onManageGoal, onViewResults, onOpenPublishing, deliveryBoard, period = 'week', rangeBusy = false }: {
  deliveryBoard?: ReactNode;
  period?: Period; data: DigitalEmployeeOverview; businessLine: BusinessLine; contentPlatform: ContentPlatform;
  onPeriodChange: (period: Period) => void; onManageGoal: () => void; onViewResults: () => void; onOpenPublishing: () => void; rangeBusy?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(10);
  const snapshot = data.businessSnapshot;
  const production = snapshot?.content.production;
  const ready = production?.status === 'available';
  const projects = ready ? (production.projects || []).filter(item => contentPlatform === 'all' || item.platform === contentPlatform) : [];
  const matches = (item: typeof projects[number], value: Filter) => value === 'all' || (value === 'clone' ? item.route === 'clone' && item.completed : value === 'digital' ? item.digitalPresenter && item.completed : value === 'pending' ? item.completed && !item.approved : value === 'blocked' ? item.blocked : item[value]);
  const visible = projects.filter(item => matches(item, filter));
  const cards: Array<[Filter, string]> = [['all', '生产项目'], ['completed', '已生成成片'], ['pending', '待审核作品'], ['approved', '审核通过'], ['blocked', '受阻项目']];
  const openProject = (id: string) => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'smartAssets', view: 'create', studioPanel: 'projects', businessRef: { entityId: id } } }));
  const chooseFilter = (next: Filter) => { setFilter(next); setLimit(10); };
  return <div className="space-y-4" aria-busy={rangeBusy}>
    <section className="section-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-bold text-text-primary">生产与交付</h2><p className="mt-1 text-xs text-text-secondary">查看完成了哪些工作、产出了哪些作品，以及哪里需要处理。</p></div>
        <div className="flex flex-wrap gap-4 border-b border-border" aria-label="生产统计周期">{([['week','本周'],['lastWeek','上周'],['month','本月'],['lastMonth','上月']] as const).map(([id,label]) => <button key={id} disabled={rangeBusy} aria-pressed={period === id} onClick={() => onPeriodChange(id)} className={`border-b-2 px-0.5 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 ${period === id ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'}`}>{label}</button>)}</div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"><div><p className="text-sm font-semibold text-text-primary">{data.goal?.title || '尚未制定本轮目标'}</p><p className="mt-1 text-xs text-text-secondary">{data.plan ? `本轮计划 ${data.plan.tasks.length} 项任务 · 已完成 ${data.tasks.filter(item => item.status === 'succeeded').length} 项` : '制定目标后查看计划任务'}</p></div><button onClick={onManageGoal} className="border-b border-accent/30 pb-0.5 text-xs font-semibold text-accent hover:border-accent hover:text-accent-dim">查看计划与执行 →</button></div>
    </section>
    {deliveryBoard}
    {businessLine !== 'customer_conversion' && <section className="section-panel p-5">
      <h3 className="font-bold text-text-primary">内容生产</h3>
      <p className="mt-1 text-xs leading-relaxed text-text-secondary">{production?.note || '等待作品数据返回，暂不显示数量。'}{contentPlatform !== 'all' && ` 当前仅统计标记为 ${contentPlatform} 的作品。`}</p>
      {!ready && <p role="status" className="mt-3 border-l-2 border-amber bg-amber-dim px-3 py-2 text-sm text-amber">作品数据尚未完整加载，请稍后重试。</p>}
      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5">{cards.map(([id,label]) => <button key={id} disabled={!ready || rangeBusy} aria-pressed={filter === id} onClick={() => chooseFilter(id)} className={`rounded-md border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 ${filter === id ? 'border-border-bright bg-[#eff7f1]' : 'border-border bg-surface-2/50 hover:bg-surface-2'}`}><span className="text-xs text-text-secondary">{label}</span><strong className="mt-2 block text-xl text-text-primary">{ready ? projects.filter(item => matches(item,id)).length : '—'}</strong></button>)}</div>
      <div className="mt-3 flex flex-wrap gap-4 border-b border-border">{([['clone','爆款裂变成片'],['digital','数字人成片']] as const).map(([id,label]) => <button key={id} disabled={!ready || rangeBusy} aria-pressed={filter === id} onClick={() => chooseFilter(id)} className={`border-b-2 px-0.5 py-2 text-sm transition-colors ${filter === id ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>{label} <b>{ready ? projects.filter(item => matches(item,id)).length : '—'}</b> 件 →</button>)}</div>
      <div className="mt-4 divide-y divide-border border-y border-border">{visible.slice(0,limit).map(item => <button key={item.id} onClick={() => openProject(item.id)} className="flex w-full flex-wrap items-center justify-between gap-2 px-2 py-3 text-left transition-colors hover:bg-surface-2"><span className="min-w-0"><span className="block break-words text-sm font-medium text-text-primary">{item.title}</span><span className="text-xs text-text-muted">{({clone:'爆款裂变',product:'产品生成',material:'素材生成'} as Record<string,string>)[item.route] || '未标注创作方式'}{item.digitalPresenter ? ' · 数字人出镜' : ''}</span></span><span className="text-xs text-text-secondary">{item.blocked ? '受阻' : item.approved ? '审核通过' : item.completed ? '待审核' : '制作中'} · 打开作品 →</span></button>)}</div>
      {ready && !visible.length && <p className="py-6 text-center text-sm text-text-muted">当前周期与筛选下没有作品。</p>}
      {visible.length > limit && <button onClick={() => setLimit(limit + 10)} className="mt-2 text-sm text-accent hover:text-accent-dim">查看更多作品（共 {visible.length} 件）</button>}
      <div className="mt-4 border-t border-border pt-4"><div className="flex justify-between"><h3 className="text-sm font-bold text-text-primary">发布执行 · 全部平台</h3><button onClick={onOpenPublishing} className="text-xs text-accent hover:text-accent-dim">查看发布记录 →</button></div><div className="data-strip mt-3 grid-cols-3 divide-x divide-border">{([['待发布',snapshot?.content.scheduledPosts],['已发布',snapshot?.content.publishedPosts],['发布失败',snapshot?.content.failedPosts]] as Array<[string,BusinessMetric | undefined]>).map(([label,metric]) => <div key={label} className="p-3"><p className="text-xs text-text-secondary">{label}</p><p className="mt-2 text-lg font-semibold text-text-primary">{metricValue(metric)}</p></div>)}</div><p className="mt-2 text-xs text-text-muted">发布按发布记录计数，已发布需有平台回执；同一作品可以发布多次。未接账号时显示未知。</p></div>
    </section>}
    {businessLine !== 'content_growth' && <section className="section-panel p-5"><h3 className="font-bold text-text-primary">客户跟进执行</h3><p className="mt-1 text-xs text-text-secondary">查看跟进准备与发送回执，询盘和成交结果在首页查看。</p><div className="data-strip mt-3 grid-cols-2 sm:grid-cols-4 sm:divide-x sm:divide-border">{([['跟进草稿',snapshot?.customer.followupDrafts],['跟进批次',snapshot?.customer.outreachBatches],['真实发送',snapshot?.customer.outreachSent],['发送失败',snapshot?.customer.outreachFailed]] as Array<[string,BusinessMetric | undefined]>).map(([label,metric]) => <div key={label} className="p-4"><p className="text-xs text-text-secondary">{label}</p><p className="mt-2 text-xl font-semibold text-text-primary">{metricValue(metric)}</p></div>)}</div></section>}
    <section className="insight-note flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-semibold text-text-primary">这些工作带来了什么结果？</p><p className="mt-1 text-xs text-[#805c47]">前往首页查看对应业务的曝光、询盘和成交；首页按渠道数据口径展示，不代表本轮任务的归因结果。</p></div><button onClick={onViewResults} className="shrink-0 border-b border-accent/30 pb-0.5 text-sm font-semibold text-accent hover:border-accent hover:text-accent-dim">查看经营结果 →</button></section>
  </div>;
}
