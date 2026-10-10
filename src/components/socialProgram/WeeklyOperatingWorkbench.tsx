import {WeeklyCancellationStatus} from './WeeklyCancellationStatus';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { socialProgramApi, type WeeklyTechnicalRepairCapacityPreview } from '../../lib/socialProgramApi';
import type {WeeklyCreativeRepairCapacityPreview} from '../../../shared/contracts/weeklyCreativeRepairExecution';
import { projectWeeklyWorkbench, type WorkbenchEvidenceKind } from './weeklyWorkbenchModel';
import WeeklyCustomerCalendar from './WeeklyCustomerCalendar';
import { projectExecutionCalendar } from './weeklyExecutionCalendar';
import { STEP_LABEL } from './weeklyExecutionLabels';
import WeeklyRecoveryPanel from './WeeklyRecoveryPanel';
import PublicationReceptionSetup from './PublicationReceptionSetup';
import WeeklyMaterialRequestsPanel from './WeeklyMaterialRequestsPanel';
import { bindWeeklyMaterialRequest } from '../../lib/weeklyMaterialBinding';
import WeeklyCustomerRunBinding from './WeeklyCustomerRunBinding';
import type {WeeklyProductionRepairCase} from '../../../shared/contracts/weeklyProductionRepairCase';

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
  const [repairCases,setRepairCases]=useState<WeeklyProductionRepairCase[]>([]);
  const [repairCapacity,setRepairCapacity]=useState<Record<string,WeeklyTechnicalRepairCapacityPreview>>({});
  const [creativeRepairCapacity,setCreativeRepairCapacity]=useState<Record<string,WeeklyCreativeRepairCapacityPreview>>({});
  const [repairCaps,setRepairCaps]=useState<Record<string,string>>({});
  const [creativeRepairDrafts,setCreativeRepairDrafts]=useState<Record<string,{revisionScope:string;estimatedDurationMinutes:string;maximumCostCny:string;deadlineAt:string}>>({});
  const [repairBusy,setRepairBusy]=useState<Record<string,'configure'|'preview'|'confirm'|'start'|'reconcile'|'audit'|'refresh'>>({});
  const [repairErrors,setRepairErrors]=useState<Record<string,string>>({});
  const [executionLoading, setExecutionLoading] = useState(false);
  const [executionError, setExecutionError] = useState('');
  const [cancellation, setCancellation] = useState<WeeklyCancellationSummary | null>(null);
  const [planningBusy, setPlanningBusy] = useState(false);
  const [planningError, setPlanningError] = useState('');
  const [selectedPublicationTaskId, setSelectedPublicationTaskId] = useState('');
  const [ownedPercent, setOwnedPercent] = useState('');
  const packageIdentity = pkg ? `${pkg.programId}:${pkg.packageId}:${pkg.version}` : '';
  const packageIdentityRef = useRef(packageIdentity);
  const loadGenerationRef = useRef(0);
  packageIdentityRef.current = packageIdentity;
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
    if (!pkg) { setExecutionTasks([]); setRepairCases([]); setRepairCapacity({}); setCreativeRepairCapacity({}); setRepairCaps({}); setCreativeRepairDrafts({}); setRepairBusy({}); setRepairErrors({}); setCancellation(null); return; }
    const generation = ++loadGenerationRef.current;
    let cancelled = false;
    setExecutionTasks([]);
    setRepairCases([]);
    setRepairCapacity({});
    setCreativeRepairCapacity({});
    setRepairCaps({});
    setCreativeRepairDrafts({});
    setRepairBusy({});
    setRepairErrors({});
    setCancellation(null);
    setExecutionLoading(true);
    setExecutionError('');
    let reading = false;
    const read = async () => {
      if (reading || cancelled) return;
      reading = true;
      try {
        const [items, receipt,repairs] = await Promise.all([socialProgramApi.listExecutionTasks(pkg.programId, pkg.packageId, pkg.version), socialProgramApi.readCancellation(pkg.programId, pkg.packageId, pkg.version),socialProgramApi.listRepairCases(pkg.programId,pkg.packageId,pkg.version)]);
        if (!cancelled && loadGenerationRef.current === generation) { setExecutionTasks(items); setRepairCases(repairs); setCancellation(receipt); setExecutionError(''); }
      } catch (cause) {
        if (!cancelled && loadGenerationRef.current === generation) setExecutionError(cause instanceof Error ? cause.message : '制作排期读取失败。');
      } finally { reading = false; if (!cancelled && loadGenerationRef.current === generation) setExecutionLoading(false); }
    };
    void read();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void read(); }, 10_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void read(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; if (loadGenerationRef.current === generation) loadGenerationRef.current += 1; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
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
  const selectedRepairCases=useMemo(()=>repairCases.filter(item=>item.publicationTaskId===selectedPublicationTaskId&&!['resolved','cancelled'].includes(item.state)),[repairCases,selectedPublicationTaskId]);
  const sharedExecutionTasks = useMemo(() => executionTasks
    .filter(item => item.publicationTaskId === null)
    .sort((left, right) => Date.parse(left.schedule.estimatedStartAt) - Date.parse(right.schedule.estimatedStartAt)), [executionTasks]);

  const refreshExecutionTasks = async (currentPackage: WeeklyOperatingPackage): Promise<void> => {
    setExecutionTasks(await socialProgramApi.listExecutionTasks(currentPackage.programId, currentPackage.packageId, currentPackage.version));
  };
  type RepairAction='configure'|'preview'|'confirm'|'start'|'reconcile'|'audit'|'refresh';
  const beginRepairAction=(caseId:string,action:RepairAction)=>{setRepairBusy(current=>({...current,[caseId]:action}));setRepairErrors(current=>{const next={...current};delete next[caseId];return next;});};
  const finishRepairAction=(caseId:string,action:RepairAction)=>setRepairBusy(current=>{if(current[caseId]!==action)return current;const next={...current};delete next[caseId];return next;});
  const setRepairFailure=(caseId:string,cause:unknown,fallback:string)=>setRepairErrors(current=>({...current,[caseId]:cause instanceof Error?cause.message:fallback}));
  const reloadRepairCases=async(scope:WeeklyOperatingPackage):Promise<WeeklyProductionRepairCase[]>=>{const identity=`${scope.programId}:${scope.packageId}:${scope.version}`,rows=await socialProgramApi.listRepairCases(scope.programId,scope.packageId,scope.version);if(packageIdentityRef.current===identity)setRepairCases(rows);return rows;};
  const previewRepair=async(item:WeeklyProductionRepairCase)=>{if(!pkg||item.kind!=='technical_scene_repair')return;const scope=pkg,identity=packageIdentity;beginRepairAction(item.caseId,'preview');try{const value=await socialProgramApi.previewTechnicalRepairCapacity(scope.programId,scope.packageId,scope.version,item.caseId);if(packageIdentityRef.current!==identity)return;setRepairCapacity(current=>({...current,[item.caseId]:value}));setRepairCaps(current=>({...current,[item.caseId]:String(value.preview.quote?.totalUpperBoundCny??0)}));}catch(cause){if(packageIdentityRef.current===identity)setRepairFailure(item.caseId,cause,'返工容量核验失败。');}finally{if(packageIdentityRef.current===identity)finishRepairAction(item.caseId,'preview');}};
  const confirmRepair=async(item:WeeklyProductionRepairCase)=>{if(!pkg)return;const proposal=repairCapacity[item.caseId],cap=Number(repairCaps[item.caseId]);if(!proposal||!Number.isFinite(cap))return;const scope=pkg,identity=packageIdentity;beginRepairAction(item.caseId,'confirm');try{const updated=await socialProgramApi.confirmTechnicalRepairCapacity(scope.programId,scope.packageId,scope.version,item.caseId,{expectedCaseRecordHash:proposal.caseRecordHash,expectedPreviewHash:proposal.preview.previewHash,...(proposal.preview.quote?{expectedQuoteHash:proposal.preview.quote.recordHash}:{}),authorizedMaximumCostCny:cap});if(packageIdentityRef.current!==identity)return;setRepairCases(current=>current.map(row=>row.caseId===updated.caseId?updated:row));setRepairCapacity(current=>({...current,[item.caseId]:{...proposal,caseRecordHash:updated.recordHash,admission:updated.admission}}));}catch(cause){if(packageIdentityRef.current===identity){const message=cause instanceof Error?cause.message:'';if(/preview_changed|version_conflict|source_changed|expired/i.test(message))setRepairCapacity(current=>{const next={...current};delete next[item.caseId];return next;});setRepairFailure(item.caseId,cause,'返工容量确认失败。');try{await reloadRepairCases(scope);}catch{}}}finally{if(packageIdentityRef.current===identity)finishRepairAction(item.caseId,'confirm');}};
  const startRepair=async(item:WeeklyProductionRepairCase)=>{if(!pkg)return;const scope=pkg,identity=packageIdentity;beginRepairAction(item.caseId,'start');try{const updated=await socialProgramApi.startTechnicalRepair(scope.programId,scope.packageId,scope.version,item.caseId,item.recordHash);if(packageIdentityRef.current!==identity)return;setRepairCases(current=>current.map(row=>row.caseId===updated.caseId?updated:row));}catch(cause){if(packageIdentityRef.current===identity){const message=cause instanceof Error?cause.message:'';if(/capacity_confirmation_expired|preview_changed/i.test(message))setRepairCapacity(current=>{const next={...current};delete next[item.caseId];return next;});setRepairFailure(item.caseId,cause,'返工作业启动失败。');try{await reloadRepairCases(scope);}catch{}}}finally{if(packageIdentityRef.current===identity)finishRepairAction(item.caseId,'start');}};
  const refreshExpiredRepair=async(item:WeeklyProductionRepairCase)=>{if(!pkg)return;const scope=pkg,identity=packageIdentity;beginRepairAction(item.caseId,'refresh');try{const rows=await reloadRepairCases(scope);if(packageIdentityRef.current!==identity)return;const updated=rows.find(row=>row.caseId===item.caseId);if(updated?.state==='awaiting_capacity')await previewRepair(updated);else setRepairErrors(current=>({...current,[item.caseId]:'容量确认已过期；服务端尚未重新开放确认，请刷新后重试。'}));}catch(cause){if(packageIdentityRef.current===identity)setRepairFailure(item.caseId,cause,'返工状态刷新失败。');}finally{if(packageIdentityRef.current===identity)finishRepairAction(item.caseId,'refresh');}};
  const configureCreativeRepair=async(item:WeeklyProductionRepairCase)=>{if(!pkg||item.kind!=='creative_revision')return;const draft=creativeRepairDrafts[item.caseId];const minutes=Number(draft?.estimatedDurationMinutes),maximumCostCny=Number(draft?.maximumCostCny),deadlineStamp=Date.parse(draft?.deadlineAt??''),publishStamp=Date.parse(item.affectedPublishWindow);if(!draft?.revisionScope.trim()||!Number.isSafeInteger(minutes)||minutes<1||!Number.isFinite(maximumCostCny)||maximumCostCny<0||!Number.isFinite(deadlineStamp)){setRepairErrors(current=>({...current,[item.caseId]:'请明确填写修订范围、整数工时、预算上限和有效截止时间。'}));return;}if(deadlineStamp<=Date.now()+minutes*60_000||!Number.isFinite(publishStamp)||deadlineStamp>=publishStamp){setRepairErrors(current=>({...current,[item.caseId]:'返工截止必须留足预计工时，并且早于真实发布窗口。'}));return;}const scope=pkg,identity=packageIdentity;beginRepairAction(item.caseId,'configure');try{await socialProgramApi.configureCreativeRepair(scope.programId,scope.packageId,scope.version,item.caseId,item.tenantId,{expectedCaseHash:item.recordHash,revisionScope:draft.revisionScope.trim(),estimatedDurationMinutes:minutes,maximumCostCny,deadlineAt:new Date(deadlineStamp).toISOString()});if(packageIdentityRef.current!==identity)return;await reloadRepairCases(scope);}catch(cause){if(packageIdentityRef.current===identity)setRepairFailure(item.caseId,cause,'创意返工范围确认失败。');}finally{if(packageIdentityRef.current===identity)finishRepairAction(item.caseId,'configure');}};
  const previewCreativeRepair=async(item:WeeklyProductionRepairCase)=>{if(!pkg||item.kind!=='creative_revision')return;const scope=pkg,identity=packageIdentity;beginRepairAction(item.caseId,'preview');try{const value=await socialProgramApi.previewCreativeRepairCapacity(scope.programId,scope.packageId,scope.version,item.caseId);if(packageIdentityRef.current!==identity)return;setCreativeRepairCapacity(current=>({...current,[item.caseId]:value}));setRepairCaps(current=>({...current,[item.caseId]:String(value.localOnly?0:value.maximumCostCny)}));}catch(cause){if(packageIdentityRef.current===identity)setRepairFailure(item.caseId,cause,'创意返工容量核验失败。');}finally{if(packageIdentityRef.current===identity)finishRepairAction(item.caseId,'preview');}};
  const confirmCreativeRepair=async(item:WeeklyProductionRepairCase)=>{if(!pkg)return;const preview=creativeRepairCapacity[item.caseId],cap=Number(repairCaps[item.caseId]);if(!preview||!Number.isFinite(cap)||cap<0||cap>preview.maximumCostCny||(preview.localOnly&&cap!==0)){setRepairErrors(current=>({...current,[item.caseId]:'允许费用必须在本次预览的预算边界内；本地路线费用只能为 0。'}));return;}const scope=pkg,identity=packageIdentity;beginRepairAction(item.caseId,'confirm');try{const updated=await socialProgramApi.confirmCreativeRepairCapacity(scope.programId,scope.packageId,scope.version,item.caseId,{expectedCaseRecordHash:preview.caseRecordHash,expectedConfigurationHash:preview.configurationHash,expectedPreviewHash:preview.previewHash,expectedAuthorityHash:preview.authorityHash,...(preview.quoteHash?{expectedQuoteHash:preview.quoteHash}:{}),authorizedMaximumCostCny:cap});if(packageIdentityRef.current!==identity)return;setRepairCases(current=>current.map(row=>row.caseId===updated.caseId?updated:row));}catch(cause){if(packageIdentityRef.current===identity){const message=cause instanceof Error?cause.message:'';if(/changed|expired|version_conflict/i.test(message))setCreativeRepairCapacity(current=>{const next={...current};delete next[item.caseId];return next;});setRepairFailure(item.caseId,cause,'创意返工容量确认失败。');try{await reloadRepairCases(scope);}catch{}}}finally{if(packageIdentityRef.current===identity)finishRepairAction(item.caseId,'confirm');}};
  const runCreativeRepairAction=async(item:WeeklyProductionRepairCase,action:'start'|'reconcile'|'audit')=>{if(!pkg)return;const scope=pkg,identity=packageIdentity;beginRepairAction(item.caseId,action);try{const updated=action==='start'?await socialProgramApi.startCreativeRepair(scope.programId,scope.packageId,scope.version,item.caseId,item.recordHash):action==='reconcile'?await socialProgramApi.reconcileCreativeRepair(scope.programId,scope.packageId,scope.version,item.caseId):await socialProgramApi.auditCreativeRepair(scope.programId,scope.packageId,scope.version,item.caseId);if(packageIdentityRef.current!==identity)return;setRepairCases(current=>current.map(row=>row.caseId===updated.caseId?updated:row));}catch(cause){if(packageIdentityRef.current===identity){setRepairFailure(item.caseId,cause,action==='audit'?'创意返工复检失败。':'创意返工执行状态核验失败。');try{await reloadRepairCases(scope);}catch{}}}finally{if(packageIdentityRef.current===identity)finishRepairAction(item.caseId,action);}};
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
        {!!selectedRepairCases.length&&<div className="mt-5 space-y-3">{selectedRepairCases.map(item=>{
          const deadlineStamp=item.deadlineAt?Date.parse(item.deadlineAt):Number.NaN;
          const overdue=!['resolved','cancelled'].includes(item.state)&&Number.isFinite(deadlineStamp)&&Date.now()>deadlineStamp;
          const capacityExpired=item.state==='ready'&&Boolean(item.admission)&&(Date.now()>Date.parse(item.admission!.capacityWindow.startsAt)+300_000||Date.now()+(item.estimatedDurationMinutes??0)*60_000>Date.parse(item.admission!.capacityWindow.deadlineAt));
          const busyAction=repairBusy[item.caseId];
          const proposal=repairCapacity[item.caseId];
          const creativeProposal=creativeRepairCapacity[item.caseId];
          const creativePreviewExpired=Boolean(creativeProposal&&Date.now()>=Date.parse(creativeProposal.availableUntil));
          const creativeDraft=creativeRepairDrafts[item.caseId]??{revisionScope:'',estimatedDurationMinutes:'',maximumCostCny:'',deadlineAt:''};
          const updateCreativeDraft=(field:keyof typeof creativeDraft,value:string)=>setCreativeRepairDrafts(current=>({...current,[item.caseId]:{...(current[item.caseId]??creativeDraft),[field]:value}}));
          return <article key={item.caseId} data-repair-case={item.caseId} className={`rounded-xl border p-4 ${overdue?'border-red-500 bg-red-100 ring-1 ring-red-300':'border-red-200 bg-red-50'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black text-red-700">动态返工任务 · 内容 Agent主负责</p><h4 className="mt-1 text-sm font-bold text-text-primary">{item.kind==='technical_scene_repair'?`修复 ${item.affectedSceneIds.length} 个质检失败镜头`:'按用户反馈重新编导并生成成片'}</h4></div><span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-red-700">{{awaiting_configuration:'待补范围与预算',awaiting_capacity:'待确认容量',ready:capacityExpired?'容量已过期':'待执行',running:item.kind==='creative_revision'?'执行中 / 回执对账':'执行中',awaiting_audit:'待复检',resolved:'已完成',cancelled:'已取消'}[item.state]}</span></div>
            <div className="mt-3 grid gap-2 text-xs text-text-secondary sm:grid-cols-2"><p>负责人：{item.ownerUserId}</p><p>复检人：{item.reviewerUserId}</p><p className={overdue?'font-bold text-red-800':''}>截止：{item.deadlineAt?timeLabel(item.deadlineAt):'待明确确认'}{overdue?' · 已逾期':''}</p><p>预算上限：{item.maximumCostCny===null?'待明确确认':`¥${item.maximumCostCny}`}</p></div>
            {item.trigger.type==='user_changes_requested'&&<p className="mt-3 rounded-lg bg-white/80 px-3 py-2 text-xs text-text-secondary">用户反馈：{item.trigger.note}</p>}
            {item.configurationGaps.length>0&&<p className="mt-2 text-xs text-red-700">待补：{item.configurationGaps.join('、')}</p>}
            {item.kind==='creative_revision'&&item.state==='awaiting_configuration'&&<div className="mt-3 grid gap-3 rounded-lg bg-white/80 p-3 text-xs sm:grid-cols-2">
              <label className="sm:col-span-2">明确修订范围<textarea value={creativeDraft.revisionScope} onChange={event=>updateCreativeDraft('revisionScope',event.target.value)} maxLength={4000} placeholder="例如：只修改前三秒钩子、CTA 分镜和配音，保留产品事实与品牌调性" className="mt-1 min-h-20 w-full rounded border border-border px-2 py-1.5"/></label>
              <label>预计工时（分钟）<input type="number" min="1" max="1440" step="1" value={creativeDraft.estimatedDurationMinutes} onChange={event=>updateCreativeDraft('estimatedDurationMinutes',event.target.value)} className="mt-1 w-full rounded border border-border px-2 py-1.5"/></label>
              <label>预算上限（元）<input type="number" min="0" step="0.01" value={creativeDraft.maximumCostCny} onChange={event=>updateCreativeDraft('maximumCostCny',event.target.value)} className="mt-1 w-full rounded border border-border px-2 py-1.5"/></label>
              <label className="sm:col-span-2">返工截止时间（必须早于发布窗口）<input type="datetime-local" value={creativeDraft.deadlineAt} onChange={event=>updateCreativeDraft('deadlineAt',event.target.value)} className="mt-1 w-full rounded border border-border px-2 py-1.5"/></label>
              <div className="sm:col-span-2"><button type="button" disabled={Boolean(busyAction)} onClick={()=>void configureCreativeRepair(item)} className="btn-primary disabled:opacity-50">{busyAction==='configure'?'正在冻结范围…':'确认并冻结返工范围'}</button><p className="mt-2 text-[10px] text-text-muted">确认后范围、工时、预算与截止时间不可静默改写；随后才会核验真实容量。</p></div>
            </div>}
            {item.kind==='creative_revision'&&item.state==='awaiting_capacity'&&<div className="mt-3 rounded-lg bg-white/80 p-3">{!creativeProposal||creativePreviewExpired?<><button type="button" disabled={Boolean(busyAction)} onClick={()=>void previewCreativeRepair(item)} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">{busyAction==='preview'?'正在核验…':creativePreviewExpired?'容量预览已过期，重新核验':'核验创意生产容量'}</button>{creativePreviewExpired&&<p className="mt-2 text-xs text-red-700">旧预览已过期，不能用于费用确认。</p>}</>:<><p className="text-xs text-text-secondary">尚未创建生产作业 · {creativeProposal.localOnly?'本地生产路线':`外部生产路线 · 配置预算上限 ¥${creativeProposal.maximumCostCny.toFixed(2)}`} · 预留至 {timeLabel(creativeProposal.availableUntil)}</p><p className="mt-1 text-[10px] text-text-muted">预计工时 {durationLabel(creativeProposal.estimatedDurationMinutes)}；费用确认不会自动启动作业。</p><label className="mt-2 block text-xs">明确允许费用上限（元）<input type="number" min="0" max={creativeProposal.maximumCostCny} step="0.01" disabled={creativeProposal.localOnly} value={repairCaps[item.caseId]??''} onChange={event=>setRepairCaps(current=>({...current,[item.caseId]:event.target.value}))} className="ml-2 rounded border border-border px-2 py-1"/></label><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={Boolean(busyAction)} onClick={()=>void confirmCreativeRepair(item)} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">{busyAction==='confirm'?'正在确认…':'确认容量与费用边界'}</button><button type="button" disabled={Boolean(busyAction)} onClick={()=>{setCreativeRepairCapacity(current=>{const next={...current};delete next[item.caseId];return next;});void previewCreativeRepair(item);}} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">重新核验</button></div></>}</div>}
            {item.kind==='creative_revision'&&item.state==='ready'&&<div className="mt-3 rounded-lg bg-white/80 p-3"><p className="text-xs text-text-secondary">容量和费用边界已由服务端冻结。启动时仍会再次核验预留有效期，不会把未知结果当成成功。</p><button type="button" disabled={Boolean(busyAction)} onClick={()=>void runCreativeRepairAction(item,'start')} className="btn-primary mt-2 disabled:opacity-50">{busyAction==='start'?'正在请求真实生产…':'开始真实创意返工作业'}</button></div>}
            {item.kind==='creative_revision'&&item.state==='running'&&<div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3"><p className="text-xs text-blue-800">生产作业已进入执行或回执对账阶段；当前界面只核验服务端真实状态。</p><button type="button" disabled={Boolean(busyAction)} onClick={()=>void runCreativeRepairAction(item,'reconcile')} className="mt-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">{busyAction==='reconcile'?'正在对账…':'核验真实执行回执'}</button></div>}
            {item.kind==='creative_revision'&&item.state==='awaiting_audit'&&<div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-xs text-amber-800">子成片已完成，等待内容 Agent 基于真实成片执行独立复检。</p><button type="button" disabled={Boolean(busyAction)} onClick={()=>void runCreativeRepairAction(item,'audit')} className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">{busyAction==='audit'?'正在复检…':'执行真实成片复检'}</button></div>}
            {item.kind==='technical_scene_repair'&&item.state==='awaiting_capacity'&&<div className="mt-3 rounded-lg bg-white/80 p-3">{!proposal?<button type="button" disabled={Boolean(busyAction)} onClick={()=>void previewRepair(item)} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">{busyAction==='preview'?'正在核验…':'核验真实路线与容量'}</button>:<><p className="text-xs text-text-secondary">尚未创建生产作业 · {proposal.preview.localOnly?'本地素材路线':`外部生成报价上界 ¥${proposal.preview.quote?.totalUpperBoundCny.toFixed(2)}`}</p>{proposal.preview.gaps.map(gap=><p key={gap} className="mt-1 text-xs text-red-700">{gap}</p>)}<label className="mt-2 block text-xs">明确允许费用上限（元）<input type="number" min="0" step="0.01" value={repairCaps[item.caseId]??''} onChange={event=>setRepairCaps(current=>({...current,[item.caseId]:event.target.value}))} className="ml-2 rounded border border-border px-2 py-1"/></label><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={Boolean(busyAction)||proposal.preview.gaps.length>0} onClick={()=>void confirmRepair(item)} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">{busyAction==='confirm'?'正在确认…':'确认容量与费用边界'}</button><button type="button" disabled={Boolean(busyAction)} onClick={()=>{setRepairCapacity(current=>{const next={...current};delete next[item.caseId];return next;});void previewRepair(item);}} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">重新核验</button></div></>}</div>}
            {item.kind==='technical_scene_repair'&&item.state==='ready'&&(capacityExpired?<div className="mt-3 rounded-lg border border-red-200 bg-white/80 p-3"><p className="text-xs text-red-700">容量确认已超过有效窗口，需要服务端重新开放后再确认。</p><button type="button" disabled={Boolean(busyAction)} onClick={()=>void refreshExpiredRepair(item)} className="mt-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">{busyAction==='refresh'?'正在刷新…':'刷新并重新核验'}</button></div>:<button type="button" disabled={Boolean(busyAction)} onClick={()=>void startRepair(item)} className="btn-primary mt-3 disabled:opacity-50">{busyAction==='start'?'正在创建作业…':'创建并开始真实返工作业'}</button>)}
            {item.execution&&<p className="mt-3 rounded-lg bg-white/80 px-3 py-2 text-xs text-text-secondary">真实作业 {item.execution.jobId} · 独立运行 {item.execution.runId}</p>}
            {repairErrors[item.caseId]&&<p role="alert" className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-xs text-red-800">{repairErrors[item.caseId]}</p>}
          </article>})}</div>}
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
