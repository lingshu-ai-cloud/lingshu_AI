import { Alert, Button, Drawer, Select, Tabs, Tag, Table } from "antd";
import ReviewTodoFloat, { type ReviewTodoApi } from './ReviewTodoFloat';
import NextRoundRecommendationsSection from './NextRoundRecommendationsSection';
import type { ReviewTodoBoard } from '../lib/reviewTodos';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ArrowUpRight, BarChart3, BookOpen, Check, CircleHelp, FileText, Lightbulb, Play, Search, Sparkles, Target, Users, X } from 'lucide-react';
import type { BusinessDestination, DigitalEmployeeOverview } from '../lib/digitalEmployees';
import { buildReviewInsights, reviewCategories, type ReviewCategory, type ReviewInsight } from '../lib/reviewInsights';

const icons = { channel: BarChart3, content: Play, knowledge: BookOpen, blocker: CircleHelp, opportunity: Users, product: Lightbulb, strategy: Target };
const tones = { channel: 'bg-[#eff7f1] text-accent', content: 'bg-amber-dim text-[#805c47]', knowledge: 'bg-surface-2 text-text-secondary', blocker: 'bg-amber-dim text-amber', opportunity: 'bg-[#eff7f1] text-accent', product: 'bg-amber-dim text-[#805c47]', strategy: 'bg-surface-2 text-text-primary' };
const categoryOf = (id: ReviewCategory) => reviewCategories.find(c => c.id === id)!;
const dateText = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '待确认';

interface Props {
  data: DigitalEmployeeOverview;
  onGoLive: (taskId?: string, deliveryId?: string) => void;
  onOpen: (page: BusinessDestination, view?: 'create' | 'publish') => void;
  onHistory: () => void;
  period: "week" | "lastWeek" | "month" | "lastMonth";
  onPeriodChange: (period: Props["period"]) => void;
  rangeBusy?: boolean;
  todoApi?: ReviewTodoApi;
  onGoal: (goalId: string) => void;
}

function Evidence({ insight }: { insight: ReviewInsight }) {
  const max = Math.max(1, ...insight.evidence.map(e => e.amount || 0));
  return <div className="divide-y divide-border border-y border-border">{insight.evidence.map((item, i) => <div key={`${item.label}-${i}`} className="bg-surface-2/50 px-1 py-4">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-medium text-text-secondary">{item.label}</span><span className="font-semibold text-text-primary">{item.value}</span></div>
    {item.amount !== undefined && <div className="mt-3 h-1.5 overflow-hidden rounded-sm bg-border"><div className="h-full rounded-sm bg-accent" style={{ width: `${item.amount / max * 100}%` }}/></div>}
    {item.note && <p className="mt-2 text-xs leading-5 text-text-secondary">{item.note}</p>}
  </div>)}</div>;
}

function InsightDrawer({ insight, onClose, onAction }: { insight: ReviewInsight; onClose: () => void; onAction: () => void }) {
  return <Drawer open title={categoryOf(insight.category).label} size={560} onClose={onClose} footer={<div className="flex items-center justify-between gap-4"><span className="text-xs text-text-secondary">进入对应页面继续处理</span><Button type="primary" onClick={onAction} icon={<ArrowUpRight size={16}/>}>{insight.action.label}</Button></div>}>
    <Tag color={insight.confidence === 'observed' ? 'success' : 'warning'}>{insight.confidence === 'observed' ? '已有数据支持' : '待核实候选'}</Tag>
    <h2 className="mt-4 text-xl font-semibold">{insight.title}</h2>
    <p className="mt-3 text-sm leading-7 text-text-secondary">{insight.summary}</p>
    <h3 className="mb-3 mt-6 font-semibold">判断依据</h3><Evidence insight={insight}/>
    <Alert className="mt-4" type="info" title={insight.caveat}/>
    <h3 className="mb-3 mt-6 font-semibold">建议下一步</h3><p className="text-sm leading-7 text-text-secondary">{insight.suggestion}</p>
  </Drawer>;
}

export default function WeeklyReviewPanel({ data, onGoLive, onOpen, onHistory, period, onPeriodChange, rangeBusy, todoApi, onGoal }: Props) {
  const [todoIncoming, setTodoIncoming] = useState<ReviewInsight | null>(null);
  const [todoBoard, setTodoBoard] = useState<ReviewTodoBoard | null>(null);
  const [filter, setFilter] = useState<ReviewCategory | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const insights = useMemo(() => buildReviewInsights(data), [data]);
  const selected = insights.find(i => i.id === selectedId);
  const close = useMemo(() => () => setSelectedId(null), []);
  const snapshot = data.businessSnapshot || data.liveReview?.businessSnapshot;
  const interactionReview = snapshot?.interactionReview;
  const visible = insights.filter(i => filter === 'all' || i.category === filter);
  const featured = insights.filter(i => i.confidence === 'observed').filter((item, index, list) => list.findIndex(other => other.category === item.category) === index).slice(0, 3);
  const delivered = (data.deliveries || []).filter(d => d.column === 'done');
  const openAction = (insight: ReviewInsight) => { setSelectedId(null); if (insight.action.taskId) onGoLive(insight.action.taskId); else if (insight.action.page) onOpen(insight.action.page, insight.action.page === 'smartAssets' ? 'publish' : undefined); };
  return <div className="space-y-7 pb-8" aria-busy={rangeBusy}>
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-accent"><Sparkles size={15}/>经营洞察</div><h1 className="text-2xl font-bold tracking-tight text-text-primary">每一轮，都找到下一步</h1><p className="mt-2 text-sm text-text-secondary">渠道往哪投，内容怎么拍，客户怎么推进。</p></div>
      <div className="text-left sm:text-right"><div className="flex items-center gap-3 sm:justify-end"><Button htmlType="button" onClick={onHistory} className="!h-auto min-h-9 !whitespace-normal text-xs text-text-secondary hover:text-accent">历史目标</Button><select aria-label="复盘周期" value={period} disabled={rangeBusy} onChange={e => onPeriodChange(e.target.value as Props['period'])} className="ui-field !min-h-10 !w-auto !rounded-md !px-3 !py-2 !text-sm disabled:opacity-50"><option value="week">本周</option><option value="lastWeek">上周</option><option value="month">本月</option><option value="lastMonth">上月</option></select></div><p className="mt-2 text-xs text-text-secondary">{dateText(snapshot?.range.startsAt || data.goal?.startsAt)} — {dateText(snapshot?.range.endsAt || data.goal?.endsAt)} · 全部已接入账号</p><p role="status" className="mt-1 text-xs text-text-muted">{rangeBusy ? '正在更新复盘数据…' : snapshot?.generatedAt ? `更新于 ${dateText(snapshot.generatedAt)} ${new Date(snapshot.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '等待数据回收'}</p></div>
    </header>

    <p className="text-xs leading-6 text-text-secondary">{data.run && !['succeeded', 'completed', 'failed', 'cancelled'].includes(data.run.status) ? '本轮仍在运行，以下为阶段性发现。' : ''}平台数据按所选周期统计；执行卡点与知识候选属于当前目标。</p>
    <NextRoundRecommendationsSection summary={data.review?.summary} onOpen={onOpen}/>
    <section aria-label="互动与销售资格复盘" className="rounded-md border border-border bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-base font-bold text-text-primary">互动与销售资格</h2><p className="mt-1 text-xs leading-5 text-text-secondary">{interactionReview?.note || '等待忠实互动回写与销售确认。'}</p></div>
        <span className="text-xs text-text-muted">{interactionReview?.deadline ? `数据截止 ${new Date(interactionReview.deadline).toLocaleString('zh-CN')}` : '截止时间待回流'}</span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ['评论', interactionReview?.comments],
          ['原始询盘', interactionReview?.inquiries],
          ['销售确认有效', interactionReview?.qualifiedInquiries],
          ['未知内容来源', interactionReview?.unknownSourceInquiries],
          ['CreativeLearning', interactionReview?.creativeLearnings],
        ].map(([label, value]) => <div key={String(label)} className="rounded-md bg-surface-2 px-3 py-4"><p className="text-[11px] text-text-secondary">{label}</p><p className="mt-2 text-xl font-bold text-text-primary">{typeof value === 'number' ? value.toLocaleString('zh-CN') : '—'}</p></div>)}
      </div>
      {interactionReview?.breakdown.length ? <details className="mt-4 border-t border-border pt-4"><summary className="cursor-pointer text-xs font-semibold text-text-secondary">按经营方向—账号—内容查看</summary><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead className="text-text-muted"><tr><th className="pb-2">经营方向</th><th className="pb-2">账号</th><th className="pb-2">内容</th><th className="pb-2 text-right">评论</th><th className="pb-2 text-right">询盘</th><th className="pb-2 text-right">有效询盘</th></tr></thead><tbody className="divide-y divide-border">{interactionReview.breakdown.map((row, index) => <tr key={`${row.businessDirectionRef || 'unknown'}-${row.accountId}-${row.contentId || 'unknown'}-${index}`}><td className="py-2.5">{row.businessDirectionRef || '未标记'}</td><td className="py-2.5">{row.accountId || '未知'}</td><td className="py-2.5">{row.contentId || '未知来源'}</td><td className="py-2.5 text-right">{row.comments}</td><td className="py-2.5 text-right">{row.inquiries}</td><td className="py-2.5 text-right">{row.qualifiedInquiries}</td></tr>)}</tbody></table></div></details> : null}
    </section>
    <section aria-label="本期值得行动" className="home-insight-panel p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-base font-bold text-text-primary"><span className="h-2 w-2 rounded-full bg-amber"/>本期值得行动</h2><span className="text-xs text-[#805c47]">优先看这几件事</span></div>
      {featured.length ? <div className={`grid gap-3 ${featured.length === 2 ? 'md:grid-cols-2' : featured.length >= 3 ? 'md:grid-cols-3' : ''}`}>{featured.map((item, index) => <Button key={item.id} htmlType="button" onClick={() => setSelectedId(item.id)} className="!h-auto min-h-9 !whitespace-normal group flex flex-col rounded-md border border-[#eadfd5] bg-white/70 p-5 text-left transition-colors hover:border-[#d9bca5] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f3b37a]/30"><span className="flex w-full items-center justify-between text-xs font-medium text-text-secondary">{categoryOf(item.category).label}<span className="font-mono text-text-muted">0{index + 1}</span></span><h3 className="mb-2 mt-3 text-base font-bold leading-7 text-text-primary">{item.title}</h3><p className="line-clamp-2 text-sm leading-6 text-text-secondary">{item.summary}</p><span className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-accent">查看判断与行动<ArrowRight size={14}/></span></Button>)}</div> : <div className="flex items-start gap-3 border-y border-[#eadfd5] bg-white/60 p-5"><Search size={20} className="mt-1 shrink-0 text-accent"/><div><p className="text-sm font-semibold text-text-primary">本期还没有足够证据支持优先行动</p><p className="mt-2 text-sm leading-6 text-text-secondary">完成发布与客户沟通后，复盘会基于实际回收的数据更新。下方可查看各类洞察还需要哪些信息。</p></div></div>}
    </section>

    <section aria-label="全部洞察">
      <div className="mb-4 flex items-center gap-2"><h2 className="text-base font-bold text-text-primary">全部洞察</h2><span className="border-l border-border pl-2 text-xs text-text-secondary">{insights.length}</span></div>
      <div aria-label="洞察分类" className="mb-5 flex flex-wrap gap-5 border-b border-border">{[{ id: 'all' as const, short: '全部' }, ...reviewCategories].map(c => <Button key={c.id} htmlType="button" aria-pressed={filter === c.id} onClick={() => setFilter(c.id)} className={`!h-auto min-h-9 !whitespace-normal border-b-2 px-0.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 ${filter === c.id ? 'border-accent font-semibold text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>{c.short}</Button>)}</div>
      <div aria-live="polite" className="space-y-4">{visible.map(item => { const Icon = icons[item.category]; return <article key={item.id} className="rounded-md border border-border bg-white p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3"><span className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-semibold ${tones[item.category]}`}><Icon size={13}/>{categoryOf(item.category).label}</span><span className="text-xs text-text-muted">{item.confidence === 'observed' ? '已有数据支持' : '待核实候选'}</span></div>
        <Button htmlType="button" onClick={() => setSelectedId(item.id)} className="!h-auto min-h-9 !whitespace-normal mt-4 text-left text-lg font-bold leading-7 text-text-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25">{item.title}</Button><p className="mt-2 max-w-4xl text-sm leading-7 text-text-secondary">{item.summary}</p>
        {item.category === 'channel' && <div className="data-strip mt-4 grid-cols-2 sm:grid-cols-4 sm:divide-x sm:divide-border">{item.evidence.map(e => <div key={e.label} className="px-4 py-3"><p className="text-xs text-text-secondary">{e.label}</p><p className="mt-1 text-base font-bold text-text-primary">{e.value}</p></div>)}</div>}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><Button htmlType="button" onClick={() => setSelectedId(item.id)} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"><FileText size={14}/>查看依据<ArrowRight size={13}/></Button><span className="flex flex-wrap items-center gap-3"><Button htmlType="button" onClick={() => setTodoIncoming(item)} className="!h-auto min-h-9 !whitespace-normal text-xs font-semibold text-accent hover:text-accent-dim">{todoBoard?.items.some(t => t.sourceIds.includes(item.id)) ? '已加入下周待办 · 查看' : '加入下周待办'}</Button><Button htmlType="button" onClick={() => openAction(item)} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-md border border-border-bright bg-[#eff7f1] px-3.5 py-2 text-xs font-semibold text-accent hover:bg-surface-2">{item.action.label}<ArrowUpRight size={14}/></Button></span></div>
      </article>; })}
      {!visible.length && <div className="border-y border-dashed border-border bg-white px-6 py-12 text-center"><Search size={25} className="mx-auto text-text-muted"/><h3 className="mt-4 text-sm font-semibold text-text-primary">{filter === 'all' ? '本期暂无可展示的洞察' : `暂无${categoryOf(filter).label}洞察`}</h3><p className="mx-auto mt-2 max-w-lg text-sm leading-7 text-text-secondary">{filter === 'all' ? '选择分类查看所需信息；有真实证据后再形成判断。' : categoryOf(filter).missing}</p>{filter !== 'all' && <Button htmlType="button" onClick={() => setFilter('all')} className="!h-auto min-h-9 !whitespace-normal mt-5 text-sm font-medium text-accent hover:text-accent-dim">查看全部洞察</Button>}</div>}
      </div>
    </section>

    <details className="rounded-md border border-border bg-white px-5 py-4"><summary className="cursor-pointer text-sm font-medium text-text-secondary">洞察覆盖与数据缺口<span className="ml-2 text-xs font-normal text-text-muted">{reviewCategories.filter(c => insights.some(i => i.category === c.id)).length} / 7 类已有发现</span></summary><div className="mt-5 grid border-y border-border sm:grid-cols-2">{reviewCategories.map((c, index) => <div key={c.id} className={`p-4 ${index % 2 === 0 && index < reviewCategories.length - 1 ? 'sm:border-r sm:border-border' : ''} ${index < reviewCategories.length - 1 ? 'border-b border-border' : ''} ${index < reviewCategories.length - (reviewCategories.length % 2 || 2) ? 'sm:border-b' : 'sm:border-b-0'}`}><p className="flex items-center gap-2 text-xs font-semibold text-text-primary">{insights.some(i => i.category === c.id) ? <Check size={14} className="text-accent"/> : <CircleHelp size={14} className="text-text-muted"/>}{c.label}</p><p className="mt-2 text-xs leading-6 text-text-secondary">{insights.some(i => i.category === c.id) ? '已有发现，具体证据与适用范围见洞察详情。' : c.missing}</p></div>)}</div>{snapshot?.dataGaps?.length ? <ul className="mt-4 space-y-2 border-t border-border pt-4 text-xs leading-5 text-text-secondary">{snapshot.dataGaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul> : null}</details>
    <details className="rounded-md border border-border bg-white px-5 py-4"><summary className="cursor-pointer text-sm font-medium text-text-secondary">执行与交付记录<span className="ml-2 text-xs font-normal text-text-muted">{delivered.length} 项已交付</span></summary><p className="mt-3 text-xs leading-5 text-text-muted">执行记录属于当前所选目标，经营指标范围以上方日期为准。</p><div className="mt-3 divide-y divide-border">{delivered.map(card => <Button key={card.id} htmlType="button" onClick={() => onGoLive(card.taskId, card.id)} className="!h-auto min-h-9 !whitespace-normal flex w-full items-center justify-between gap-3 py-4 text-left text-sm text-text-primary hover:text-accent"><span>{card.title}<span className="mt-1 block text-xs text-text-muted">{card.subject}</span></span><ArrowRight size={15}/></Button>)}</div>{!delivered.length && <p className="mt-3 text-sm text-text-muted">当前目标暂无已交付记录。</p>}<Button htmlType="button" onClick={() => onGoLive()} className="!h-auto min-h-9 !whitespace-normal mt-3 inline-flex items-center gap-2 text-xs font-semibold text-accent hover:text-accent-dim">查看任务执行<ArrowRight size={13}/></Button></details>
    <ReviewTodoFloat data={data} incoming={todoIncoming} onConsumed={() => setTodoIncoming(null)} onBoard={setTodoBoard} onGoal={onGoal} api={todoApi}/>
    {selected && <InsightDrawer insight={selected} onClose={close} onAction={() => openAction(selected)}/>}
  </div>;
}
