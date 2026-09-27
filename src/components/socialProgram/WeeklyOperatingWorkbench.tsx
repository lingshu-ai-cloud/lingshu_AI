import { AlertTriangle, ArrowUpRight, CheckCircle2, Circle, Loader2, RefreshCcw, ShieldCheck } from 'lucide-react';
import type { WeeklyOperatingPackage, WeeklyOperatingWorkflowKind } from '../../../shared/contracts/socialProgram';
import { projectWeeklyWorkbench, type WorkbenchEvidenceKind } from './weeklyWorkbenchModel';

const KIND_LABEL: Record<WeeklyOperatingWorkflowKind, string> = {
  readiness: '范围与就绪', discovery: '发现', directing: '编导', content: '生产', publishing: '发布', engagement: '互动', review: '复盘',
};
const STATUS_LABEL = { planned: '待开始', blocked: '已阻塞', in_progress: '进行中', completed: '已完成', cancelled: '已取消' } as const;
const EVIDENCE_LABEL: Record<WorkbenchEvidenceKind, string> = {
  authoritative: '权威对象', real_receipt: '真实回执', suggestion: '建议/候选', mock: 'Mock/模拟',
};

export default function WeeklyOperatingWorkbench({ pkg, loading, error, selectedTaskId, onRefresh }: {
  pkg: WeeklyOperatingPackage | null;
  loading: boolean;
  error: string;
  selectedTaskId?: string | null;
  onRefresh: () => void;
}) {
  if (loading && !pkg) return <section className="rounded-xl border border-border bg-white p-8 text-center text-sm text-text-muted"><Loader2 className="mx-auto mb-3 animate-spin" size={20}/>正在读取后端权威周包</section>;
  if (error && !pkg) return <section className="rounded-xl border border-red-200 bg-red-50 p-6"><p className="text-sm font-semibold text-red-700">{error}</p><button className="mt-3 text-sm font-bold text-accent" onClick={onRefresh}>重试</button></section>;
  if (!pkg) return <section className="rounded-xl border border-dashed border-border bg-white p-8 text-center"><p className="text-sm font-semibold text-text-primary">当前项目还没有周任务包</p><p className="mt-2 text-xs text-text-muted">工作台不会生成示例状态或伪造回执。</p></section>;

  const lanes = projectWeeklyWorkbench(pkg);
  const authorization = pkg.socialContentPackage.authorization;
  return <section aria-label="统一周工作台" className="space-y-4">
    <header className="rounded-xl border border-border bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold text-accent">{pkg.weekStart} — {pkg.weekEnd}</p><h2 className="mt-1 text-lg font-bold text-text-primary">{pkg.objective}</h2><p className="mt-2 text-xs text-text-muted">Program {pkg.programId} · Package {pkg.packageId} · v{pkg.version}</p></div><button type="button" onClick={onRefresh} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary disabled:opacity-50"><RefreshCcw size={14} className={loading ? 'animate-spin' : ''}/>从后端刷新</button></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-surface-2 p-3"><p className="text-[11px] text-text-muted">企业知识版本</p><p className="mt-1 text-sm font-bold">{pkg.enterpriseProfileRef ? `${pkg.enterpriseProfileRef.id} · v${pkg.enterpriseProfileRef.version}` : '未绑定'}</p></div><div className="rounded-lg bg-surface-2 p-3"><p className="text-[11px] text-text-muted">发布授权</p><p className="mt-1 flex items-center gap-1.5 text-sm font-bold">{authorization.allowRealPublishing ? <ShieldCheck size={15} className="text-accent"/> : <AlertTriangle size={15} className="text-amber-600"/>}{authorization.allowRealPublishing ? `已授权 · 最多 ${authorization.maxPublishItems} 条` : '未授权/已失效'}</p></div><div className="rounded-lg bg-surface-2 p-3"><p className="text-[11px] text-text-muted">工作台数据</p><p className="mt-1 text-sm font-bold">权威周包快照 · {new Date(pkg.updatedAt).toLocaleString('zh-CN')}</p></div></div>
      <div className="mt-4 flex flex-wrap gap-2 text-[10px] text-text-secondary">{(Object.keys(EVIDENCE_LABEL) as WorkbenchEvidenceKind[]).map(key => <span key={key} className="rounded-full border border-border px-2 py-1">{EVIDENCE_LABEL[key]}</span>)}</div>
    </header>
    <div className="grid gap-3 lg:grid-cols-2">{lanes.map(lane => <article key={lane.kind} className="rounded-xl border border-border bg-white p-4">
      <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-bold">{lane.status === 'completed' ? <CheckCircle2 size={16} className="text-accent"/> : lane.status === 'blocked' ? <AlertTriangle size={16} className="text-red-600"/> : <Circle size={16} className="text-text-muted"/>}{KIND_LABEL[lane.kind]}</h3><span className={`text-xs font-semibold ${lane.status === 'blocked' ? 'text-red-700' : 'text-text-secondary'}`}>{STATUS_LABEL[lane.status]}</span></div>
      {lane.blockingReasons.length > 0 && <ul className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-800">{lane.blockingReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      <div className="mt-3 space-y-2">{lane.tasks.map(row => <a id={`weekly-task-${row.task.taskId}`} key={row.task.taskId} href={row.href} className={`block rounded-lg border p-3 transition hover:border-accent ${selectedTaskId === row.task.taskId ? 'border-accent ring-2 ring-accent/15' : 'border-border'}`}>
        <div className="flex items-center justify-between gap-3"><span className="truncate text-xs font-semibold text-text-primary">{row.task.taskId}</span><span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent">处理<ArrowUpRight size={12}/></span></div>
        {row.blockerText.length > 0 && <p className="mt-2 text-xs leading-5 text-red-700">阻塞：{row.blockerText.join('；')}</p>}
        <div className="mt-2 flex flex-wrap gap-1.5">{row.evidence.map((ref, index) => <span key={`${ref.type}:${ref.id}:${ref.version}:${index}`} title={`${ref.type}:${ref.id}:v${ref.version}`} className={`rounded px-2 py-1 text-[10px] ${ref.evidenceKind === 'mock' ? 'bg-amber-100 text-amber-800' : ref.evidenceKind === 'real_receipt' ? 'bg-emerald-100 text-emerald-800' : ref.evidenceKind === 'suggestion' ? 'bg-blue-50 text-blue-700' : 'bg-surface-2 text-text-secondary'}`}>{EVIDENCE_LABEL[ref.evidenceKind]} · {ref.type} v{ref.version}</span>)}</div>
      </a>)}</div>
    </article>)}</div>
  </section>;
}
