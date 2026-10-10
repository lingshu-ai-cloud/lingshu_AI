import {WeeklyCancellationStatus} from './WeeklyCancellationStatus';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Circle, Loader2, RefreshCcw, ShieldCheck } from 'lucide-react';
import type {
  WeeklyAgentPlanningState,
  WeeklyExecutionTask,
  WeeklyCancellationSummary,
  WeeklyExecutionTaskStatus,
  WeeklyOperatingPackage,
  WeeklyOperatingWorkflowKind,
  WeeklyProductionStepKind,
  WeeklyResponsibleActor,
} from '../../../shared/contracts/socialProgram';
import { advanceWeeklyPlanning } from '../../lib/weeklyPlanningActions';
import { socialProgramApi } from '../../lib/socialProgramApi';
import { projectWeeklyWorkbench, type WorkbenchEvidenceKind } from './weeklyWorkbenchModel';
import WeeklyCustomerCalendar from './WeeklyCustomerCalendar';
import { projectExecutionCalendar } from './weeklyExecutionCalendar';
import { STEP_LABEL } from './weeklyExecutionLabels';
import WeeklyRecoveryPanel from './WeeklyRecoveryPanel';
import PublicationReceptionSetup from './PublicationReceptionSetup';
import WeeklyMaterialRequestsPanel from './WeeklyMaterialRequestsPanel';
import { bindWeeklyMaterialRequest } from '../../lib/weeklyMaterialBinding';
import WeeklyCustomerRunBinding from './WeeklyCustomerRunBinding';

const KIND_LABEL: Record<WeeklyOperatingWorkflowKind, string> = {
  readiness: '范围与就绪', discovery: '发现', directing: '编导', content: '生产', publishing: '发布', engagement: '互动', review: '复盘',
};
const STATUS_LABEL = { planned: '待开始', blocked: '已阻塞', in_progress: '进行中', completed: '已完成', cancelled: '已取消' } as const;
const EVIDENCE_LABEL: Record<WorkbenchEvidenceKind, string> = {
  authoritative: '权威对象', real_receipt: '真实回执', suggestion: '建议/候选', mock: 'Mock/模拟',
};
const ACTOR_LABEL: Record<WeeklyResponsibleActor, string> = {
  business_agent: '经营 Agent',
  director_agent: '编导 Agent',
  content_agent: '内容 Agent',
  quality_agent: '内容 Agent · 质检能力',
  publishing_agent: '经营 Agent · 发布能力',
  user: '用户',
};

const STEP_DETAIL: Record<WeeklyProductionStepKind, string> = {
  business_outline: '仅列目标、数量、账号、日期和预算，不消耗生成式 Agent token。',
  benchmark_collection: '按 TikTok 主阵地、中词主供给采集候选。',
  benchmark_scoring: '按 B2B 匹配、证据完整度和可迁移性筛选。',
  director_analysis: '输出对标账号、具体视频、结构、风格和迁移边界。',
  business_schedule: '经营 Agent 把编导结论合并成数量、账号、日期和预算均明确的排期。',
  material_preparation: '在脚本启动前准备真实素材、产品事实与授权；提交和核验使用原素材任务，不提前启动制作。',
  material_readiness: '在分镜完成后复核原素材申请、实际来源版本与消费者核验；缺少必需输入时等待补齐。',
  script: '编导 Agent 对照爆款原脚本与企业已确认事实，生成可核对的适配脚本。',
  storyboard: '编导 Agent 将适配脚本拆成可单独制作、验收和返工的逐镜分镜。',
  asset_generation: '逐镜选用企业素材、合法库存或最高档 AIGC。',
  video_generation: '执行画面、数字人、配音、字幕、剪辑和渲染。',
  quality_check: '对每个镜头和整体成片进行独立质检。',
  rework: '只重做不合格镜头，保留已通过的结果。',
  user_approval: '用统一决策卡确认成片，未确认不会真实发布。',
  publishing: '在授权范围内发布，保留平台回执。',
  performance_monitoring: '按账号回传播放、互动、询盘和成本信号。',
  weekly_review: '用真实结果生成周复盘和下一轮数量、内容与预算建议。',
  template_extraction: '从真实已发布企业成片及原周复盘提炼结构，保留原脚本、分镜和来源版本。',
  template_performance_validation: '核验模板的播放、赞转评和适用条件；明确确认试验或保留用途后交付。',
};
const EXECUTION_STATUS_LABEL: Record<WeeklyExecutionTaskStatus, string> = {
  pending_activation: '待激活', queued: '排队中', leased: '执行中', blocked: '有卡点', succeeded: '已完成', cancelled: '已取消', dead_letter: '失败待处理',
};

function durationLabel(minutes: number): string {
  if (minutes < 60) return `约 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `约 ${hours} 小时${rest ? ` ${rest} 分钟` : ''}`;
}

function timeLabel(value: string): string {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return '待上游确定';
  return new Date(stamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function taskTone(status: WeeklyExecutionTaskStatus): string {
  if (status === 'succeeded') return 'border-emerald-200 bg-emerald-50';
  if (status === 'leased') return 'border-blue-200 bg-blue-50';
  if (status === 'blocked' || status === 'dead_letter') return 'border-red-200 bg-red-50';
  return 'border-border bg-white';
}

function TaskDeadlineNotice({ task }: { task: WeeklyExecutionTask }) {
  if (!task.schedule.latestFinishAt && !task.schedule.planningRisks?.length) return null;
  const late = task.status !== 'succeeded' && task.status !== 'cancelled' && Boolean(task.schedule.latestFinishAt && Date.now() > Date.parse(task.schedule.latestFinishAt));
  return <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${late || task.schedule.planningRisks?.length ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>
    {task.schedule.latestFinishAt && <p>发布前置最晚完成：{timeLabel(task.schedule.latestFinishAt)}{late ? ' · 已超过截止' : ''}</p>}
    {task.schedule.planningRisks?.includes('publication_deadline_at_risk') && <p>当前估时不能满足发布前置截止，需要提前准备或调整排期。</p>}
    {task.schedule.planningRisks?.includes('precise_publish_time_required') && <p>请补充包含时区的具体发布时间，才能核验前置排期。</p>}
  </div>;
}

export default function WeeklyOperatingWorkbench({ pkg, loading, error, selectedTaskId, onRefresh, programRoute, onRevision }: {
  pkg: WeeklyOperatingPackage | null;
  loading: boolean;
  error: string;
  selectedTaskId?: string | null;
  onRefresh: () => void;
  programRoute?: 'cold_start' | 'account_repair' | null;
  onRevision?: (pkg: WeeklyOperatingPackage) => void;
}) {
  const [planning, setPlanning] = useState<WeeklyAgentPlanningState | null>(pkg?.agentPlanning ?? null);
  const [executionTasks, setExecutionTasks] = useState<WeeklyExecutionTask[]>([]);
  const [executionLoading, setExecutionLoading] = useState(false);
  const [executionError, setExecutionError] = useState('');
  const [cancellation, setCancellation] = useState<WeeklyCancellationSummary | null>(null);
  const [planningBusy, setPlanningBusy] = useState(false);
  const [planningError, setPlanningError] = useState('');
  const [selectedPublicationTaskId, setSelectedPublicationTaskId] = useState('');
  const [ownedPercent, setOwnedPercent] = useState('');
  useEffect(() => { setOwnedPercent(pkg?.referenceSourcePolicy ? String(pkg.referenceSourcePolicy.ownedPercent) : ''); }, [pkg?.packageId, pkg?.version]);

  const saveSourceQuota = async () => {
    if (!pkg || planningBusy || ownedPercent === '' || !programRoute || !onRevision) return;
    setPlanningBusy(true); setPlanningError('');
    try {
      const own = programRoute === 'cold_start' ? 0 : Number(ownedPercent);
      const next = await socialProgramApi.reviseOperatingPackage(pkg.programId, pkg.packageId, {
        expectedVersion: pkg.version,
        referenceSourcePolicy: { profile: programRoute === 'cold_start' ? 'b2b_cold_start' : 'b2b_established', ownedPercent: own, externalPercent: 100-own, allocationUnit: 'mother_content' },
        changeReason: '用户确认本周自有与外部参考配额',
      });
      onRevision(next);
    } catch (cause) { setPlanningError(cause instanceof Error ? cause.message : '来源配额保存失败。'); }
    finally { setPlanningBusy(false); }
  };

  useEffect(() => { setPlanning(pkg?.agentPlanning ?? null); }, [pkg?.agentPlanning]);
  useEffect(() => {
    if (!pkg) { setExecutionTasks([]); setCancellation(null); return; }
    let cancelled = false;
    setExecutionTasks([]);
    setCancellation(null);
    setExecutionLoading(true);
    setExecutionError('');
    let reading = false;
    const read = async () => {
      if (reading || cancelled) return;
      reading = true;
      try {
        const [items, receipt] = await Promise.all([socialProgramApi.listExecutionTasks(pkg.programId, pkg.packageId, pkg.version), socialProgramApi.readCancellation(pkg.programId, pkg.packageId, pkg.version)]);
        if (!cancelled) { setExecutionTasks(items); setCancellation(receipt); setExecutionError(''); }
      } catch (cause) {
        if (!cancelled) setExecutionError(cause instanceof Error ? cause.message : '制作排期读取失败。');
      } finally { reading = false; if (!cancelled) setExecutionLoading(false); }
    };
    void read();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void read(); }, 10_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void read(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [pkg?.packageId, pkg?.programId, pkg?.version]);

  const publicationTasks = pkg?.socialContentPackage.publicationTasks ?? [];
  useEffect(() => {
    if (!publicationTasks.length) { setSelectedPublicationTaskId(''); return; }
    const linked = executionTasks.find(item => item.taskId === selectedTaskId)?.publicationTaskId;
    setSelectedPublicationTaskId(current => linked || (publicationTasks.some(item => item.publicationTaskId === current) ? current : publicationTasks[0]!.publicationTaskId));
  }, [executionTasks, publicationTasks, selectedTaskId]);

  const selectedPublication = publicationTasks.find(item => item.publicationTaskId === selectedPublicationTaskId) ?? null;
  const selectedProductionTasks = useMemo(() => executionTasks
    .filter(item => item.publicationTaskId === selectedPublicationTaskId)
    .sort((left, right) => Date.parse(left.schedule.estimatedStartAt) - Date.parse(right.schedule.estimatedStartAt)), [executionTasks, selectedPublicationTaskId]);
  const sharedExecutionTasks = useMemo(() => executionTasks
    .filter(item => item.publicationTaskId === null)
    .sort((left, right) => Date.parse(left.schedule.estimatedStartAt) - Date.parse(right.schedule.estimatedStartAt)), [executionTasks]);

  const refreshExecutionTasks = async (currentPackage: WeeklyOperatingPackage): Promise<void> => {
    setExecutionTasks(await socialProgramApi.listExecutionTasks(currentPackage.programId, currentPackage.packageId, currentPackage.version));
  };
  const recheckMaterials = async (task: WeeklyExecutionTask) => {
    if (!pkg || planningBusy || task.status !== 'blocked' || !task.ownBlockingReasons.includes('weekly_required_materials_missing')) return;
    setPlanningBusy(true); setPlanningError('');
    try { setExecutionTasks(await socialProgramApi.recheckRequiredMaterials(pkg.programId, pkg.packageId, task.taskId, pkg.version)); }
    catch (cause) { setPlanningError(cause instanceof Error ? cause.message : '素材重新核验请求失败。'); }
    finally { setPlanningBusy(false); }
  };
  const advancePlanning = async (): Promise<void> => {
    if (!pkg || !planning || planningBusy) return;
    setPlanningBusy(true);
    setPlanningError('');
    try {
      const next = await advanceWeeklyPlanning(pkg.programId, pkg.packageId, pkg.version, planning, setPlanning);
      setPlanning(next);
      await refreshExecutionTasks(pkg);
      onRefresh();
    } catch (cause) {
      setPlanningError(cause instanceof Error ? cause.message : 'Agent 计划处理失败。');
    } finally { setPlanningBusy(false); }
  };
  const revisePlanning = async (): Promise<void> => {
    if (!pkg || !planning || planningBusy || !['confirmed', 'dispatched'].includes(planning.status)) return;
    setPlanningBusy(true);
    setPlanningError('');
    try {
      const next = await socialProgramApi.reviseOperatingPackage(pkg.programId, pkg.packageId, {
        expectedVersion: pkg.version,
        changeReason: '用户在周工作台修订已确认计划并重新规划',
      });
      // Reload the whole package: a revision changes package identity/version too.
      if (onRevision) onRevision(next);
      else onRefresh();
    } catch (cause) {
      setPlanningError(cause instanceof Error ? cause.message : '创建计划修订失败。');
    } finally { setPlanningBusy(false); }
  };
  const approveTask = async (task: WeeklyExecutionTask): Promise<void> => {
    if (!pkg || planningBusy) return;
    setPlanningBusy(true);
    setPlanningError('');
    try {
      setExecutionTasks(await socialProgramApi.approveExecutionTask(pkg.programId, pkg.packageId, task.taskId));
      onRefresh();
    } catch (cause) {
      setPlanningError(cause instanceof Error ? cause.message : '成片确认失败。');
    } finally { setPlanningBusy(false); }
  };

  if (loading && !pkg) return <section className="rounded-xl border border-border bg-white p-8 text-center text-sm text-text-muted"><Loader2 className="mx-auto mb-3 animate-spin" size={20}/>正在读取后端权威周包</section>;
  if (error && !pkg) return <section className="rounded-xl border border-red-200 bg-red-50 p-6"><p className="text-sm font-semibold text-red-700">{error}</p><button className="mt-3 text-sm font-bold text-accent" onClick={onRefresh}>重试</button></section>;
  if (!pkg) return <section className="rounded-xl border border-dashed border-border bg-white p-8 text-center"><p className="text-sm font-semibold text-text-primary">当前项目还没有周任务包</p><p className="mt-2 text-xs text-text-muted">工作台不会生成示例状态或伪造回执。</p></section>;

  const lanes = projectWeeklyWorkbench(pkg);
  const authorization = pkg.socialContentPackage.authorization;
  const planningAction = planning?.status === 'outline_ready' || planning?.status === 'director_analyzing'
    ? '生成爆款视频与素材组合预览'
    : planning?.status === 'awaiting_confirmation' ? '确认本周详细计划'
      : planning?.status === 'confirmed' ? '由经营 Agent 派单开始制作' : '';
  const selectedScheduleItem = planning?.detailedSchedule?.items.find(item => item.publicationTaskId === selectedPublicationTaskId) ?? null;
  return <section aria-label="统一周工作台" className="space-y-4">
    {pkg && <section className="rounded-xl border border-border bg-white p-5">
      <h3 className="text-sm font-bold">本周复刻来源配额</h3>
      <p className="mt-2 text-xs text-text-secondary">{pkg.referenceSourcePolicy ? `自有 ${pkg.referenceSourcePolicy.ownedPercent}% / 外部 ${pkg.referenceSourcePolicy.externalPercent}% · 按母版计数` : '尚未确认来源配额'}</p>
      {planning && <p className="mt-1 text-xs text-text-muted">实际分配：自有 {planning.skeleton.slots.filter(slot => slot.referenceSource === 'owned').length} 条 / 外部 {planning.skeleton.slots.filter(slot => slot.referenceSource === 'external').length} 条；未标来源 {planning.skeleton.slots.filter(slot => !slot.referenceSource).length} 条。</p>}
      {planning?.directorAnalyses.filter(item => item.benchmarkAccountRefs.some(ref => ref.type === 'owned_social_account')).map(item => <p key={item.analysisId} className="mt-2 rounded-lg bg-surface-2 p-3 text-xs text-text-secondary">
        自有参考 {item.benchmarkVideoRefs.map(ref => ref.id).join('、')}：{item.historicalPerformance ? `播放 ${item.historicalPerformance.metrics.views ?? '未知'} · 赞 ${item.historicalPerformance.metrics.likes ?? '未知'} · 转 ${item.historicalPerformance.metrics.shares ?? '未知'} · 评 ${item.historicalPerformance.metrics.comments ?? '未知'}；采集 ${item.historicalPerformance.capturedAt}，来源 ${item.historicalPerformance.source}` : '尚无匹配的播放和赞转评快照'}
      </p>)}
      {programRoute === 'account_repair' && onRevision && <div className="mt-3 flex flex-wrap gap-2">
        <select aria-label="自有与外部来源比例" value={ownedPercent} onChange={event => setOwnedPercent(event.target.value)} disabled={planningBusy} className="rounded-lg border border-border px-3 py-2 text-xs">
          <option value="">请选择来源比例</option>
          <option value="40">40 / 60 · 调性清晰、获客一般或增长停滞</option>
          <option value="20">20 / 80 · 历史素材不足或播放、赞转评偏弱</option>
        </select>
        <button type="button" disabled={planningBusy || loading || !['20','40'].includes(ownedPercent)} onClick={() => void saveSourceQuota()} className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-50">确认配额并创建新修订</button>
      </div>}
      <p className="mt-2 text-xs text-text-muted">新修订需要重新生成排期并确认；已有执行保留。自有证据不足时提示补齐，不自动转成全部外部。</p>
    </section>}
    {pkg && onRevision && <details className="rounded-xl border border-border bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">配置视频发布承接入口</summary><PublicationReceptionSetup key={`reception:${pkg.packageId}:${pkg.version}`} pkg={pkg} onCreateRevision={async publicationTasks => {
      const next = await socialProgramApi.reviseOperatingPackage(pkg.programId, pkg.packageId, { expectedVersion: pkg.version, publicationTasks, changeReason: '确认逐视频发布承接要求' });
      onRevision(next);
    }} /></details>}
    {pkg && <WeeklyMaterialRequestsPanel key={`materials:${pkg.packageId}:${pkg.version}`} programId={pkg.programId} packageId={pkg.packageId} packageVersion={pkg.version} tasks={executionTasks} requiredRequestIds={pkg.socialContentPackage.publicationTasks.flatMap(item => item.materialRequirement?.requestIds ?? [])} onBindRequiredRequests={onRevision ? async request => {
      try { await bindWeeklyMaterialRequest({ pkg, tasks: executionTasks, request, onRevision }); }
      catch (cause) { setPlanningError(cause instanceof Error ? cause.message : '素材已创建，冻结排期关联尚未完成。'); throw cause; }
    } : undefined} />}
    {pkg && programRoute && <details className="rounded-xl border border-border bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">选择本周客服运行</summary><WeeklyCustomerRunBinding key={`customer:${pkg.packageId}:${pkg.version}`} programId={pkg.programId} packageId={pkg.packageId} packageVersion={pkg.version} profile={programRoute === 'cold_start' ? 'b2b_cold_start' : 'b2b_established'} /></details>}
    {pkg && !executionLoading && !executionError && <WeeklyCustomerCalendar programId={pkg.programId} packageId={pkg.packageId} packageVersion={pkg.version} weekStart={pkg.weekStart} weekEnd={pkg.weekEnd} executionTasks={executionTasks} onOpenMaterial={requestId => document.getElementById(`weekly-material-request:${pkg.programId}:${pkg.packageId}:${pkg.version}:${requestId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} mainTasks={projectExecutionCalendar(executionTasks, STEP_LABEL)} onOpenContent={task => {
      if (!task.productionTaskId) return;
      window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'smartAssets', socialContentTaskId: task.productionTaskId, socialContentPage: 'smartAssets', socialContentView: 'managed' } }));
    }} />}
    {pkg && !executionLoading && !executionError && executionTasks.length > 0 && <WeeklyRecoveryPanel
      key={`${pkg.packageId}:${pkg.version}`}
      tasks={executionTasks}
      packageVersion={pkg.version}
      onAssess={input => socialProgramApi.assessRecovery(pkg.programId, pkg.packageId, pkg.version, input)}
    />}
    {cancellation && <WeeklyCancellationStatus cancellation={cancellation}/>}
    <header className="rounded-xl border border-border bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold text-accent">{pkg.weekStart} — {pkg.weekEnd}</p><h2 className="mt-1 text-lg font-bold text-text-primary">{pkg.objective}</h2><p className="mt-2 text-xs text-text-muted">Program {pkg.programId} · Package {pkg.packageId} · v{pkg.version}</p></div><button type="button" onClick={onRefresh} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary disabled:opacity-50"><RefreshCcw size={14} className={loading ? 'animate-spin' : ''}/>从后端刷新</button></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-surface-2 p-3"><p className="text-[11px] text-text-muted">企业知识版本</p><p className="mt-1 text-sm font-bold">{pkg.enterpriseProfileRef ? `${pkg.enterpriseProfileRef.id} · v${pkg.enterpriseProfileRef.version}` : '未绑定'}</p></div><div className="rounded-lg bg-surface-2 p-3"><p className="text-[11px] text-text-muted">发布授权</p><p className="mt-1 flex items-center gap-1.5 text-sm font-bold">{authorization.allowRealPublishing ? <ShieldCheck size={15} className="text-accent"/> : <AlertTriangle size={15} className="text-amber-600"/>}{authorization.allowRealPublishing ? `已授权 · 最多 ${authorization.maxPublishItems} 条` : '未授权/已失效'}</p></div><div className="rounded-lg bg-surface-2 p-3"><p className="text-[11px] text-text-muted">工作台数据</p><p className="mt-1 text-sm font-bold">权威周包快照 · {new Date(pkg.updatedAt).toLocaleString('zh-CN')}</p></div></div>
      <div className="mt-4 flex flex-wrap gap-2 text-[10px] text-text-secondary">{(Object.keys(EVIDENCE_LABEL) as WorkbenchEvidenceKind[]).map(key => <span key={key} className="rounded-full border border-border px-2 py-1">{EVIDENCE_LABEL[key]}</span>)}</div>
    </header>

    <section className="rounded-xl border border-border bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-[11px] font-black uppercase tracking-[.14em] text-accent">Two-step planning</p><h3 className="mt-1 text-base font-bold text-text-primary">任务生成分两步，用户确认后才生产</h3><p className="mt-1 text-xs leading-5 text-text-muted">编导 Agent 分析爆款并负责原脚本拆解、企业适配脚本和分镜；经营 Agent 据此制定详细选题、账号、日期和预算排期；内容 Agent 只执行正式派单。</p></div>
        {planningAction && <button type="button" disabled={planningBusy} onClick={() => void advancePlanning()} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">{planningBusy&&<Loader2 size={14} className="animate-spin"/>}{planningAction}<ArrowUpRight size={14}/></button>}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <article className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black text-emerald-700">第一步 · 经营 Agent</p><h4 className="mt-1 text-sm font-bold text-text-primary">免费任务总纲</h4></div><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-emerald-700">0 token</span></div><p className="mt-2 text-xs leading-5 text-text-secondary">共 {planning?.skeleton.slots.reduce((sum, slot) => sum + slot.quantity, 0) ?? pkg.socialContentPackage.publicationTaskTarget} 条，分配到 {new Set(publicationTasks.map(item => item.accountId)).size} 个账号；只确定目标、产量、平台、日期和预算，不调用生成模型。</p></article>
        <article className={`rounded-xl border p-4 ${planning?.detailedSchedule ? 'border-violet-100 bg-violet-50/60' : 'border-dashed border-border bg-surface-2/60'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black text-violet-700">第二步 · 编导分析 → 经营合并</p><h4 className="mt-1 text-sm font-bold text-text-primary">爆款视频预览 + 素材组合预览</h4></div><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-violet-700">{planning?.detailedSchedule ? '已生成' : '待生成'}</span></div><p className="mt-2 text-xs leading-5 text-text-secondary">{planning?.detailedSchedule ? `已生成 ${planning.detailedSchedule.items.length} 条可追溯详细排期；每条已绑定对标证据、素材方案、账号和发布窗口。` : '需要已通过服务端评分的 B2B 对标账号与视频；详细分析才会产生 Agent 消耗。'}</p></article>
      </div>
      {(planning?.status === 'confirmed' || planning?.status === 'dispatched') && <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3">
        <p className="text-xs leading-5 text-text-secondary">本周计划已冻结。修改时创建新修订，重新生成排期并确认；旧计划和派单记录保留，已有执行不会因修订被撤销。</p>
        <button type="button" disabled={planningBusy || loading} onClick={() => void revisePlanning()} className="mt-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">创建修订并重新规划</button>
      </div>}
      {planning?.status === 'dispatched'&&<p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">用户已确认，经营 Agent 已向内容 Agent 下发 {planning.dispatch?.scheduleItemIds.length ?? 0} 条正式任务。</p>}
      {planningError&&<p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{planningError}</p>}
    </section>

    <section className="rounded-xl border border-border bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[11px] font-black uppercase tracking-[.14em] text-accent">Production schedule</p><h3 className="mt-1 text-base font-bold text-text-primary">制作每一步、责任 Agent 与预计时间</h3><p className="mt-1 text-xs leading-5 text-text-muted">时间来自后端任务排期；真实开始和完成后会保留实际时间。</p></div><div className="min-w-[240px]"><label htmlFor="weekly-publication-task" className="block text-[10px] font-bold text-text-muted">查看某条内容</label><select id="weekly-publication-task" value={selectedPublicationTaskId} onChange={event => setSelectedPublicationTaskId(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-text-primary">{publicationTasks.map((item, index) => <option key={item.publicationTaskId} value={item.publicationTaskId}>{index + 1}. {item.platform.toUpperCase()} · {item.accountId} · {item.businessProposition || '待确认选题'}</option>)}</select></div></div>
      {executionLoading&&<p className="mt-4 inline-flex items-center gap-2 text-xs text-text-muted"><Loader2 size={14} className="animate-spin"/>正在读取真实执行任务…</p>}
      {executionError&&<p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{executionError}</p>}
      {!executionLoading&&!executionError&&selectedPublication&&<>
        <div className="mt-4 grid gap-3 sm:grid-cols-4"><div className="rounded-lg bg-surface-2 p-3"><p className="text-[10px] text-text-muted">平台 / 账号</p><p className="mt-1 text-xs font-bold">{selectedPublication.platform.toUpperCase()} · {selectedPublication.accountId}</p></div><div className="rounded-lg bg-surface-2 p-3"><p className="text-[10px] text-text-muted">发布窗口</p><p className="mt-1 text-xs font-bold">{selectedPublication.publishWindow || '待经营 Agent 排期'}</p></div><div className="rounded-lg bg-surface-2 p-3"><p className="text-[10px] text-text-muted">单条制作预计</p><p className="mt-1 text-xs font-bold">{selectedScheduleItem ? durationLabel(selectedScheduleItem.estimatedProductionMinutes) : durationLabel(selectedProductionTasks.reduce((sum, item) => sum + item.schedule.estimatedDurationMinutes, 0))}</p></div><div className="rounded-lg bg-surface-2 p-3"><p className="text-[10px] text-text-muted">素材可否开始</p><p className="mt-1 text-xs font-bold">{selectedProductionTasks.some(task => task.schedule.stepKind === 'material_readiness' && task.status === 'succeeded') ? '素材任务已核验通过' : '等待素材任务实际核验'}</p></div></div>
        {selectedScheduleItem&&<div className="mt-3 rounded-lg border border-violet-100 bg-violet-50/50 p-3 text-xs leading-5 text-text-secondary"><strong className="text-text-primary">对标与素材依据：</strong>视频 {selectedScheduleItem.benchmarkVideoRefs.map(ref => ref.id).join('、') || '无'} · 账号 {selectedScheduleItem.benchmarkAccountRefs.map(ref => ref.id).join('、') || '无'}<br/><strong className="text-text-primary">素材规划：</strong>{selectedScheduleItem.materialPlan.note}</div>}
        <ol className="mt-5 space-y-3">{selectedProductionTasks.map((task, index) => <li id={`weekly-execution-${task.taskId}`} key={task.taskId} className={`relative rounded-xl border p-4 ${taskTone(task.status)} ${selectedTaskId === task.taskId ? 'ring-2 ring-accent/20' : ''}`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[10px] font-black text-text-secondary">{index + 1}</span><h4 className="text-sm font-bold text-text-primary">{STEP_LABEL[task.schedule.stepKind]}</h4><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-text-secondary">{ACTOR_LABEL[task.schedule.responsibleActor]}</span></div><p className="mt-2 text-xs leading-5 text-text-secondary">{STEP_DETAIL[task.schedule.stepKind]}</p></div><span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-text-secondary">{EXECUTION_STATUS_LABEL[task.status]}</span></div><div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-black/5 pt-3 text-[10px] text-text-muted"><span>预计耗时：<strong className="text-text-secondary">{durationLabel(task.schedule.estimatedDurationMinutes)}</strong></span><span>预计开始：<strong className="text-text-secondary">{timeLabel(task.schedule.estimatedStartAt)}</strong></span><span>预计完成：<strong className="text-text-secondary">{timeLabel(task.schedule.estimatedFinishAt)}</strong></span>{task.schedule.actualStartedAt&&<span>实际开始：<strong className="text-text-secondary">{timeLabel(task.schedule.actualStartedAt)}</strong></span>}{task.schedule.actualFinishedAt&&<span>实际完成：<strong className="text-text-secondary">{timeLabel(task.schedule.actualFinishedAt)}</strong></span>}</div>{(task.ownBlockingReasons.length>0||task.inheritedBlockingTaskIds.length>0)&&<p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs leading-5 text-red-700">卡点：{[...task.ownBlockingReasons, ...task.inheritedBlockingTaskIds.map(id => `等待上游 ${id}`)].join('；')}</p>}<TaskDeadlineNotice task={task}/>{task.productionProgress&&<p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">当前制作：{task.productionProgress.step} · {task.productionProgress.activity} · 更新于 {timeLabel(task.productionProgress.updatedAt)}</p>}{task.status === 'blocked' && task.ownBlockingReasons.includes('weekly_required_materials_missing') && <button type="button" disabled={planningBusy} onClick={() => void recheckMaterials(task)} className="mt-3 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">已补交素材，重新核验</button>}{task.lastError&&<p className="mt-2 text-xs text-red-700">{task.status === 'queued' ? '等待原因' : '处理原因'}：{task.lastError.message}（{task.lastError.retryable ? '系统会继续核对或分级重试' : '需要用户或人工处理'}）</p>}{task.schedule.stepKind==='user_approval'&&task.status==='queued'&&<button type="button" disabled={planningBusy} onClick={() => void approveTask(task)} className="btn-primary mt-3 inline-flex items-center gap-2 disabled:opacity-50">{planningBusy&&<Loader2 size={13} className="animate-spin"/>}确认这条成片</button>}</li>)}</ol>
        {!selectedProductionTasks.length&&<p className="mt-5 rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-text-muted">这条内容的制作节点尚未物化，请先完成任务总纲。</p>}
      </>}
      {!!sharedExecutionTasks.length&&<details className="mt-5 rounded-xl border border-border bg-surface-2/40"><summary className="cursor-pointer px-4 py-3 text-xs font-bold text-text-primary">查看本周共同前置与收尾任务（{sharedExecutionTasks.length} 个后端节点）</summary><div className="grid gap-2 border-t border-border p-3 md:grid-cols-2">{sharedExecutionTasks.map(task => <article key={task.taskId} className={`rounded-lg border p-3 ${taskTone(task.status)}`}><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-bold text-text-primary">{STEP_LABEL[task.schedule.stepKind]}</p><p className="mt-1 text-[10px] text-text-muted">{ACTOR_LABEL[task.schedule.responsibleActor]} · {durationLabel(task.schedule.estimatedDurationMinutes)} · {timeLabel(task.schedule.estimatedFinishAt)} 前</p></div><span className="shrink-0 text-[10px] font-bold text-text-secondary">{EXECUTION_STATUS_LABEL[task.status]}</span></div><TaskDeadlineNotice task={task}/>{task.ownBlockingReasons.length>0&&<p className="mt-2 text-[10px] leading-4 text-red-700">卡点：{task.ownBlockingReasons.join('；')}</p>}</article>)}</div></details>}
    </section>

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
