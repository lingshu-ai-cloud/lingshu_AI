import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, CircleDollarSign, ExternalLink, Loader2, Target } from 'lucide-react';
import { digitalEmployeeApi, dispatchDigitalEmployeeDeepLink, type BusinessDestination, type DigitalEmployeeDeepLink, type DigitalEmployeeOverview } from '../lib/digitalEmployees';
import type { VideoCreationPlan } from '../lib/videoCreationPlan';
import { useDeliveryHandoff } from '../hooks/useDeliveryHandoff';
import { DIRECTOR_REASON_LABELS, type DirectorDecision, type DirectorDecisionReason } from '../lib/directorDecision';

const taskLabels: Record<string, string> = {
  scheduled_source_collection: '热点与素材采集', viral_analysis: '候选内容分析', content_mode_routing: '矩阵与脚本编排',
  content_production: '内容生产', content_quality_gate: '成片质检', content_release_approval: '发布审批',
};
const statusLabels: Record<string, string> = {
  pending: '待开始', running: '进行中', waiting_approval: '待审批', waiting_human: '待处理', succeeded: '已完成', failed: '失败', blocked: '受阻',
  candidate: '候选选题', script_draft: '脚本草稿', script_approved: '脚本已审', in_production: '制作中', review: '待审片', approved: '已通过', collecting: '采集中',
};

export type DirectorContextView = {
  goalTitle: string;
  week: string;
  scope: 'content' | 'week';
  stage: string;
  status: string;
  taskTitle: string;
  blocker: string;
  content: VideoCreationPlan | null;
  scriptVersions: Array<{ language: string; version: number; hash: string }>;
  productionBudget: number;
  productionSpent: number;
  productionReserved: number;
  paidMediaBudget: number;
  originalTarget: number;
  platformVersionTarget: number;
  publishTarget: number;
  collectionBrief: string;
  qualityStandard: string;
  progress: Array<{ id: string; title: string; status: string; result: string; nextStep: string; updatedAt: string }>;
};

export function buildDirectorContextView(overview: DigitalEmployeeOverview, link: DigitalEmployeeDeepLink): DirectorContextView | null {
  const pack = overview.plan?.businessPackage;
  const director = pack?.directorPlan;
  const plans = pack?.tasks.find(item => item.templateId === 'production')?.videoPlans || overview.goal?.videoPlans || [];
  if (!overview.goal && !director && !plans.length) return null;
  const ref = link.businessRef || { taskKey: '' };
  const wanted = [ref.contentId, ref.referenceId, ref.entityId].map(value => String(value || '')).filter(Boolean);
  const content = plans.find(item => wanted.includes(String(item.contentId || '')) || wanted.includes(String(item.referenceId || ''))) || null;
  const task = overview.tasks.find(item => item.id === link.taskId) || overview.tasks.find(item => item.task_key === ref.taskKey);
  const routing = overview.tasks.find(item => item.task_key === 'content_mode_routing');
  const orders = Array.isArray(routing?.output?.orders) ? routing.output.orders as Array<Record<string, unknown>> : [];
  const contentOrder = content ? orders.find(order => String((order.videoPlan as Record<string, unknown> | undefined)?.contentId || '') === String(content.contentId || '')) : undefined;
  const scripts = contentOrder?.scripts && typeof contentOrder.scripts === 'object' ? contentOrder.scripts as Record<string, Record<string, unknown>> : {};
  const starts = overview.goal?.startsAt ? new Date(`${overview.goal.startsAt}T00:00:00`).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : '';
  const ends = overview.goal?.endsAt ? new Date(`${overview.goal.endsAt}T00:00:00`).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : '';
  return {
    goalTitle: overview.goal?.title || '本周内容任务包', week: starts && ends ? `${starts}—${ends}` : '', scope: content ? 'content' : 'week',
    stage: taskLabels[task?.task_key || ref.taskKey] || task?.title || '内容编导', status: task?.blocked_reason && ['failed', 'blocked', 'waiting_external'].includes(task.status) ? '1 个节点等待处理' : statusLabels[task?.status || content?.directorStatus || ''] || task?.status || content?.directorStatus || '待编排',
    taskTitle: task?.title || '', blocker: task?.blocked_reason || '', content, scriptVersions: Object.entries(scripts).map(([language, script]) => ({ language, version: Number(script.version || 0), hash: String(script.hash || '') })),
    productionBudget: Number(director?.productionBudget || 0), productionSpent: Number(director?.productionSpent || 0), productionReserved: Number(director?.productionReserved || 0), paidMediaBudget: Number(director?.paidMediaBudget || 0),
    originalTarget: Number(director?.originalTarget || plans.length), platformVersionTarget: Number(director?.platformVersionTarget || plans.length), publishTarget: Number(director?.publishTarget || plans.length),
    collectionBrief: director?.collectionBrief || '', qualityStandard: director?.qualityStandard || '', progress: (director?.progress || []).map(item => ({ ...item, status: statusLabels[item.status] || item.status })),
  };
}

type RuntimeContext = { runId: string; taskId: string; taskKey?: string; entityId?: string; contentId?: string; referenceId?: string };

export default function DirectorTaskContext({ page, runtimeContext, className = '' }: { page: BusinessDestination; runtimeContext?: RuntimeContext; className?: string }) {
  const stored = useDeliveryHandoff(page);
  const link = useMemo<DigitalEmployeeDeepLink | null>(() => stored || (runtimeContext ? {
    page, runId: runtimeContext.runId, taskId: runtimeContext.taskId,
    businessRef: { taskKey: runtimeContext.taskKey || '', ...(runtimeContext.entityId ? { entityId: runtimeContext.entityId } : {}), ...(runtimeContext.contentId ? { contentId: runtimeContext.contentId } : {}), ...(runtimeContext.referenceId ? { referenceId: runtimeContext.referenceId } : {}) },
  } : null), [page, stored, runtimeContext?.runId, runtimeContext?.taskId, runtimeContext?.taskKey, runtimeContext?.entityId, runtimeContext?.contentId, runtimeContext?.referenceId]);
  const [overview, setOverview] = useState<DigitalEmployeeOverview | null>(null);
  const [error, setError] = useState('');
  const [decision, setDecision] = useState<DirectorDecision | ''>('');
  const [reason, setReason] = useState<DirectorDecisionReason>('weak_viral_hook');
  const [applyToSimilar, setApplyToSimilar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!link) { setOverview(null); setError(''); return; }
    const controller = new AbortController();
    void digitalEmployeeApi.overview().then(value => { if (!controller.signal.aborted) { setOverview(value); setError(''); } }).catch(() => { if (!controller.signal.aborted) setError('暂时无法读取编导任务上下文'); });
    return () => controller.abort();
  }, [link?.runId, link?.taskId, link?.businessRef?.taskKey, link?.businessRef?.entityId]);
  if (!link) return null;
  if (!overview && !error) return <section data-testid="director-task-context-loading" className={`border-b border-emerald-100 bg-emerald-50/70 px-5 py-3 text-xs text-emerald-800 ${className}`}><Loader2 className="mr-2 inline animate-spin" size={14} />正在读取本周编导任务…</section>;
  if (error) return <section role="alert" className={`flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-900 ${className}`}><AlertCircle size={14} />{error}</section>;
  const view = overview ? buildDirectorContextView(overview, link) : null;
  if (!view) return null;
  const currency = overview?.plan?.businessPackage?.directorPlan?.currency === 'USD' ? '$' : '¥';
  const remaining = Math.max(0, view.productionBudget - view.productionSpent - view.productionReserved);
  const go = (destination: BusinessDestination, taskKey: string, viewMode?: 'create' | 'publish') => dispatchDigitalEmployeeDeepLink({ ...link, page: destination, view: viewMode, businessRef: { ...link.businessRef, taskKey } });
  const submitDecision = async (next: DirectorDecision) => {
    if (!view.content?.contentId || !link.taskId) return;
    if (next !== 'continue' && decision !== next) { setDecision(next); setNotice(''); return; }
    setBusy(true); setNotice('');
    try {
      const updated = await digitalEmployeeApi.directorDecision(link.taskId, { contentId: view.content.contentId, decision: next, ...(next !== 'continue' ? { reason, applyToSimilar } : {}) });
      setOverview(updated); setDecision(''); setApplyToSimilar(false);
      setNotice(next === 'continue' ? '已继续当前方向' : next === 'adjust' ? '已交给编导 Agent 重新编排' : '已放弃当前方向，编导 Agent 正在自动补位');
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : '方向操作失败'); }
    finally { setBusy(false); }
  };
  return <section data-testid="director-task-context" className={`border-b border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-white px-4 py-3 sm:px-6 ${className}`}>
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white">编导任务</span><strong className="truncate text-sm text-slate-900">{view.goalTitle}</strong>{view.week && <span className="text-xs text-slate-500">{view.week}</span>}<span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[11px] text-emerald-800">{view.stage} · {view.status}</span></div>
          <p className="mt-2 text-xs leading-5 text-slate-600">{view.scope === 'content' ? `${view.content?.productName || '当前内容'} · ${view.content?.theme || view.content?.buyerProblem || '待补充主题'}` : '当前展示本周任务包汇总；选择具体内容后将自动定位到单条任务。'}</p></div>
        <div className="flex flex-wrap gap-2 text-[11px]"><button type="button" onClick={() => go('socialInspiration', 'viral_analysis')} className="rounded border border-emerald-200 bg-white px-2.5 py-1.5 font-semibold text-emerald-800">灵感</button><button type="button" onClick={() => go('scriptLibrary', 'content_mode_routing')} className="rounded border border-emerald-200 bg-white px-2.5 py-1.5 font-semibold text-emerald-800">脚本</button><button type="button" onClick={() => go('smartAssets', 'content_production', 'create')} className="rounded bg-emerald-700 px-2.5 py-1.5 font-semibold text-white">进入制作 <ExternalLink className="ml-1 inline" size={11}/></button></div>
      </div>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded border border-slate-200 bg-white p-2.5"><p className="text-slate-500">买家问题</p><p className="mt-1 line-clamp-2 font-medium text-slate-800">{view.content?.buyerProblem || view.content?.theme || '按周计划待细化'}</p></div>
        <div className="rounded border border-slate-200 bg-white p-2.5"><p className="text-slate-500">证据要求</p><p className="mt-1 line-clamp-2 font-medium text-slate-800">{view.content?.evidenceRequirement || view.qualityStandard || '按质量标准执行'}</p></div>
        <div className="rounded border border-slate-200 bg-white p-2.5"><p className="flex items-center gap-1 text-slate-500"><CircleDollarSign size={12}/>生产预算</p><p className="mt-1 font-semibold text-slate-800">剩余 {currency}{remaining.toLocaleString()} <span className="font-normal text-slate-500">/ {currency}{view.productionBudget.toLocaleString()}</span></p></div>
        <div className="rounded border border-slate-200 bg-white p-2.5"><p className="flex items-center gap-1 text-slate-500"><Target size={12}/>本周产出</p><p className="mt-1 font-semibold text-slate-800">原创 {view.originalTarget} · 版本 {view.platformVersionTarget} · 发布 {view.publishTarget}</p></div>
      </div>
      {view.scope === 'content' && <div className="mt-3 rounded-lg border border-emerald-200 bg-white p-3" data-testid="director-direction-controls"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold text-slate-800">方向判断</p><p className="mt-0.5 text-[11px] text-slate-500">当前自动化：{{ suggest: '建议', collaborate: '协作', managed: '托管', automatic: '全自动' }[overview?.config?.autonomyMode || 'managed']} · 可随时覆盖 Agent 的决定</p>{view.scriptVersions.length > 0 && <p className="mt-1 text-[11px] font-medium text-emerald-700">编导确认脚本：{view.scriptVersions.map(item => `${item.language.toUpperCase()} v${item.version} · ${item.hash.slice(0, 8)}`).join('；')}</p>}</div><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void submitDecision('continue')} className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 disabled:opacity-50">继续</button><button type="button" disabled={busy} onClick={() => void submitDecision('adjust')} className={`rounded border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${decision === 'adjust' ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-700'}`}>调整</button><button type="button" disabled={busy} onClick={() => void submitDecision('abandon')} className={`rounded border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${decision === 'abandon' ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-700'}`}>放弃</button></div></div>
        {(decision === 'adjust' || decision === 'abandon') && <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3"><label className="min-w-40 flex-1 text-[11px] font-semibold text-slate-600">原因<select aria-label="方向纠偏原因" value={reason} onChange={event => setReason(event.target.value as DirectorDecisionReason)} className="mt-1 block w-full rounded border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800">{Object.entries(DIRECTOR_REASON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="flex items-center gap-2 pb-2 text-[11px] text-slate-600"><input type="checkbox" checked={applyToSimilar} onChange={event => setApplyToSimilar(event.target.checked)}/>同时影响本周同类内容</label><button type="button" disabled={busy} onClick={() => void submitDecision(decision)} className="rounded bg-slate-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? '处理中…' : `确认${decision === 'adjust' ? '调整' : '放弃'}`}</button><button type="button" disabled={busy} onClick={() => setDecision('')} className="px-2 py-2 text-xs text-slate-500">取消</button></div>}
        {notice && <p role="status" className={`mt-2 text-[11px] ${/失败|无法|缺少/.test(notice) ? 'text-rose-700' : 'text-emerald-700'}`}>{notice}</p>}
      </div>}
      <details className="mt-2 text-xs"><summary className="flex cursor-pointer list-none items-center gap-1 font-semibold text-emerald-800"><ChevronDown size={13}/>查看编导过程与完整约束</summary><div className="mt-2 grid gap-3 rounded border border-emerald-100 bg-white p-3 lg:grid-cols-2"><div><p className="font-semibold text-slate-700">采集与选题范围</p><p className="mt-1 leading-5 text-slate-600">{view.collectionBrief || '尚未填写'}</p><p className="mt-2 font-semibold text-slate-700">脚本与审片标准</p><p className="mt-1 leading-5 text-slate-600">{view.qualityStandard || '尚未填写'}</p>{view.blocker && <p className="mt-2 text-amber-700">当前阻塞：{view.blocker}</p>}</div><div><p className="font-semibold text-slate-700">过程记录</p>{view.progress.length ? <ol className="mt-1 space-y-2">{view.progress.map(item => <li key={item.id} className="border-l-2 border-emerald-200 pl-2"><p className="font-medium text-slate-800">{item.title} · {item.status}</p>{item.result && <p className="text-slate-600">结果：{item.result}</p>}{item.nextStep && <p className="text-emerald-800">下一步：{item.nextStep}</p>}</li>)}</ol> : <p className="mt-1 text-slate-500">暂无过程记录；执行后会在此持续显示结果与下一步。</p>}</div></div></details>
    </div>
  </section>;
}
