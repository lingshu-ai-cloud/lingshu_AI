import {openCustomerCalendarTask,type CustomerCalendarProjection} from '../socialProgram/CustomerWeeklyCalendar';
import {readWeeklyContentNavigation,weeklyContentNavigationDetail} from '../../lib/weeklyContentNavigationApi';
import {parseWeeklyProfileCreation,type WeeklyProfileUpgrade,type WeeklyProfileCreationIntent} from '../../lib/weeklyProfileUpgradeApi';
import WeeklyInventoryReusePanel from '../socialProgram/WeeklyInventoryReusePanel';
import WeeklyProfileUpgradePanel from '../socialProgram/WeeklyProfileUpgradePanel';
import {projectCrossWeekMaterials,validCrossWeekMaterialTarget,crossWeekMaterialPanelId} from '../socialProgram/crossWeekMaterialCalendar';
import type {CrossWeekMaterialContinuationView} from '../../../shared/contracts/weeklyCrossWeekMaterialContinuation';
import CrossWeekMaterialContinuationPanel from '../socialProgram/CrossWeekMaterialContinuationPanel';
import {projectCustomerExceptions,validCustomerExceptionTarget,customerExceptionPanelId} from '../socialProgram/weeklyCustomerExceptionCalendar';
import type {WeeklyCustomerExceptionRequest} from '../../../shared/contracts/weeklyCustomerKnowledgeQuote';
import BoundWeeklyCustomerKnowledgeQuotePanel from '../socialProgram/BoundWeeklyCustomerKnowledgeQuotePanel';
import {projectPublicationRecoveries,validPublicationRecoveryTarget,publicationRecoveryPanelId} from '../socialProgram/weeklyPublicationRecoveryCalendar';
import type {WeeklyPublicationRecovery} from '../../../shared/contracts/weeklyPublicationRecovery';
import WeeklyPublicationRecoveryPanel from '../socialProgram/WeeklyPublicationRecoveryPanel';
import WeeklyPublicationExecutionPanel,{publicationExecutionPanelId} from '../socialProgram/WeeklyPublicationExecutionPanel';
import {validPublicationExecutionTarget} from '../socialProgram/publicationExecutionCalendarNavigation';
import {projectNativeRecoveries,validNativeRecoveryTarget,nativeRecoveryPanelId} from '../socialProgram/weeklyNativeRecoveryCalendar';
import type {WeeklyNativeSendRecovery} from '../../../shared/contracts/weeklyNativeSendRecovery';
import WeeklyNativeSendRecoveryPanel from '../socialProgram/WeeklyNativeSendRecoveryPanel';
import WeeklyNativeDispatchPanel from '../socialProgram/WeeklyNativeDispatchPanel';
import WeeklyCustomerChannelScopePanel from '../socialProgram/WeeklyCustomerChannelScopePanel';
import WeeklyCustomerSendRecoveryPanel,{requestPanelId} from '../socialProgram/WeeklyCustomerSendRecoveryPanel';
import {validCustomerSendRecoveryTarget} from '../socialProgram/weeklyCustomerSendRecoveryNavigation';
import type {WeeklyCustomerSendRecovery} from '../../../shared/contracts/weeklyCustomerSendRecovery';
import {getToken} from '../../lib/auth';
import {verifyProductionSnapshotHash} from '../../lib/socialSceneReworkNavigation';
import {sceneCalendarExecution,sceneCalendarChoices,isSceneContentExecution} from '../socialProgram/sceneCalendarNavigation';
import {socialContentApi} from '../../lib/socialContentApi';
import {studioApi} from '../../lib/studioApi';
import {socialSceneReworkApi} from '../../lib/socialSceneReworkApi';
import {sceneStudioNavigationDetail,type ScopedSceneTarget} from '../../lib/scopedSceneNavigation';
import AgentWeeklyCalendar,{type AgentCalendarTask} from './AgentWeeklyCalendar';
import type {WeeklyScheduleConfirmation} from '../../../shared/contracts/socialWeeklyScheduleRevision';
import {revealWeeklySalesAction} from '../socialProgram/weeklySalesNavigation';
import WeeklySalesHandoffPanel from '../socialProgram/WeeklySalesHandoffPanel';
import { useEffect, useRef, useState } from 'react';
import type { WeeklyMaterialRequest } from '../../../server/socialPrograms/weeklyMaterialRequests';
import { bindWeeklyMaterialRequest,type WeeklyHumanMaterialBinding } from '../../lib/weeklyMaterialBinding';
import WeeklyMaterialRequestsPanel from '../socialProgram/WeeklyMaterialRequestsPanel';
import { openMaterialPanelRequest } from '../socialProgram/weeklyMaterialNavigation';
import type { WeeklyExecutionTask, WeeklyOperatingPackage } from '../../../shared/contracts/socialProgram';
import { useOptionalSocialProgram } from '../../contexts/SocialProgramContext';
import { socialProgramApi } from '../../lib/socialProgramApi';
import { projectExecutionCalendar } from '../socialProgram/weeklyExecutionCalendar';
import { STEP_LABEL } from '../socialProgram/weeklyExecutionLabels';
import AgentOperatingControls from '../socialProgram/AgentOperatingControls';
import WeeklyCustomerCalendar from '../socialProgram/WeeklyCustomerCalendar';
import { revealWeeklyPlanningTask } from '../socialProgram/planningCalendarNavigation';
import WeeklyReviewEvidencePanel from '../socialProgram/WeeklyReviewEvidencePanel';
import { revealWeeklyReviewTask } from '../socialProgram/reviewCalendarNavigation';
import { revealWeeklyTemplateTask } from '../socialProgram/templateCalendarNavigation';
import WeeklyContentTemplatesPanel from '../socialProgram/WeeklyContentTemplatesPanel';
import WeeklyRunningResourceEvidencePanel from '../socialProgram/WeeklyRunningResourceEvidencePanel';
import WeeklySupplementRequestsPanel from '../socialProgram/WeeklySupplementRequestsPanel';
import { projectWeeklySupplementRequests, supplementPanelRequestId } from '../socialProgram/weeklySupplementCalendarProjection';
import type { WeeklySupplementRequest } from '../../../shared/contracts/weeklySupplementRequests';

const identity = (pkg: WeeklyOperatingPackage) => JSON.stringify([pkg.packageId, pkg.version]);
export default function ConnectedAgentCalendar({accountBindingTasks=[]}:{accountBindingTasks?:AgentCalendarTask[]}={}) {
  const context = useOptionalSocialProgram();
  const program = context?.activeProgram;
  const [packages, setPackages] = useState<WeeklyOperatingPackage[]>([]);
  const [selected, setSelected] = useState('');
  const [sendRecoveries,setSendRecoveries]=useState<{identity:string;items:WeeklyCustomerSendRecovery[]}|null>(null);
  const sendRecoveryIdentity=useRef('');
  const [crossWeekMaterials,setCrossWeekMaterials]=useState<{identity:string;items:CrossWeekMaterialContinuationView[]}|null>(null);
  const [customerExceptions,setCustomerExceptions]=useState<{identity:string;items:WeeklyCustomerExceptionRequest[]}|null>(null);
  const [selectedCustomerRun,setSelectedCustomerRun]=useState<{selection:string;taskId:string;token:string;projection:CustomerCalendarProjection}|null>(null);
  const [selectedCustomerExecution,setSelectedCustomerExecution]=useState<{selection:string;taskId:string}|null>(null);
  const [selectedPublicationExecution,setSelectedPublicationExecution]=useState<{selection:string;taskId:string}|null>(null);
  const [publicationRecoveries,setPublicationRecoveries]=useState<{identity:string;items:WeeklyPublicationRecovery[]}|null>(null);
  const [nativeRecoveries,setNativeRecoveries]=useState<{identity:string;items:WeeklyNativeSendRecovery[]}|null>(null);
  const sceneReadGeneration=useRef(0);
  const [sceneChoices,setSceneChoices]=useState<{selection:string;generation:number;card:AgentCalendarTask;items:Array<{target:ScopedSceneTarget;label:string;reasons:string[]}>}|null>(null);
  const [sceneUpstream,setSceneUpstream]=useState<{selection:string;tasks:WeeklyExecutionTask[]}|null>(null);
  const [sceneReading,setSceneReading]=useState<string|null>(null);
  const [tasks, setTasks] = useState<WeeklyExecutionTask[]>([]);
  const materialPanel=useRef<HTMLDivElement>(null);
  const salesPanel=useRef<HTMLDivElement>(null);
  const currentSelection=useRef('');
  const taskReadGeneration=useRef(0);
  const [bindingContext,setBindingContext]=useState('');
  const [bindingError,setBindingError]=useState('');
  const [bindingBusy,setBindingBusy]=useState(false);
  const [materialRecoveryBusy,setMaterialRecoveryBusy]=useState<string|null>(null);
  const [retryRequest,setRetryRequest]=useState<WeeklyMaterialRequest|null>(null);
  const [retryBindings,setRetryBindings]=useState<WeeklyHumanMaterialBinding[]>([]);
  const [scheduleOutcome,setScheduleOutcome]=useState<WeeklyScheduleConfirmation|null>(null);
  const [selectedReview,setSelectedReview]=useState<{selection:string;taskId:string}|null>(null);
  const [selectedTemplate,setSelectedTemplate]=useState<{selection:string;taskId:string}|null>(null);
  const [supplements,setSupplements]=useState<{selection:string;items:WeeklySupplementRequest[]}|null>(null);
  const [error, setError] = useState('');
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
  const loading = packagesLoading || tasksLoading;
  currentSelection.current=JSON.stringify([program?.programId,selected]);
  useEffect(()=>{sceneReadGeneration.current++;setSceneChoices(null);setSceneUpstream(null);setSceneReading(null);},[program?.programId,selected]);
  useEffect(() => {
    let cancelled = false;
    setPackages([]); setSelected(''); setTasks([]); setError(''); setPackagesLoading(false);
    if (!program) return;
    setPackagesLoading(true);
    void socialProgramApi.listOperatingPackages(program.programId).then(items => {
      if (cancelled) return;
      setPackages(items);
      const ref = program.activeWeeklyOperatingPackageRef;
      const active = ref ? items.find(item => item.programId === program.programId && item.packageId === ref.id && item.version === ref.version) : undefined;
      if (active) setSelected(identity(active));
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : '周任务包读取失败'); })
      .finally(() => { if (!cancelled) setPackagesLoading(false); });
    return () => { cancelled = true; };
  }, [program?.programId, program?.activeWeeklyOperatingPackageRef?.id, program?.activeWeeklyOperatingPackageRef?.version]);
  const pkg = packages.find(item => item.programId === program?.programId && identity(item) === selected);
  useEffect(() => {
    let cancelled = false;
    let reading = false;
    setTasks([]); setError(''); setTasksLoading(false);
    if (!pkg || !program || pkg.programId !== program.programId) return;
    setTasksLoading(true);
    const read = async () => {
      if (cancelled || reading) return;
      reading = true;
      const generation=taskReadGeneration.current;
      try {
        const items = await socialProgramApi.listExecutionTasks(pkg.programId, pkg.packageId, pkg.version);
        if (items.some(item => item.programId !== pkg.programId || item.packageId !== pkg.packageId || item.packageVersion !== pkg.version)) throw new Error('执行任务与所选周包版本不一致，请刷新后重试。');
        if (!cancelled&&generation===taskReadGeneration.current) { setTasks(items); setError(''); }
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : '执行排期读取失败'); }
      finally { reading = false; if (!cancelled) setTasksLoading(false); }
    };
    void read();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void read(); }, 10_000);
    const visible = () => { if (document.visibilityState === 'visible') void read(); };
    document.addEventListener('visibilitychange', visible);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [pkg?.programId, pkg?.packageId, pkg?.version]);
  const scopedTasks=tasks.filter(item=>item.programId===pkg?.programId&&item.packageId===pkg?.packageId&&item.packageVersion===pkg?.version);
  const recoveryTenants=[...new Set(scopedTasks.map(task=>task.tenantId))];
  const recoveryTenant=recoveryTenants.length===1?recoveryTenants[0]:null;
  const recoveryToken=getToken();
  const recoveryScope=pkg&&recoveryTenant?{tenantId:recoveryTenant,programId:pkg.programId,packageId:pkg.packageId,packageVersion:pkg.version}:null;
  const recoveryIdentity=JSON.stringify([recoveryScope,recoveryToken]);sendRecoveryIdentity.current=recoveryIdentity;
  const openSendRecovery=(card:AgentCalendarTask)=>{
    try{if(!recoveryScope||getToken()!==recoveryToken)throw Error('当前真实租户或发送异常工作区尚未读取。');const target=validCustomerSendRecoveryTarget(card,recoveryScope);if(!target)throw Error('发送异常卡与当前真实周包身份不一致。');const node=document.getElementById(requestPanelId(recoveryScope,target.id));if(!node||node.dataset.tenant!==target.tenantId||node.dataset.program!==target.programId||node.dataset.package!==target.packageId||node.dataset.version!==String(target.packageVersion)||node.dataset.id!==target.id||node.dataset.run!==target.runId||node.dataset.task!==target.taskId||node.dataset.item!==target.itemId||node.dataset.channel!==target.channel)throw Error('指定发送异常工作区尚未读取或来源已变化，请在下方只读刷新实际记录。');node.scrollIntoView({behavior:'smooth',block:'start'});node.focus({preventScroll:true});}
    catch(cause){setBindingContext(currentSelection.current);setBindingError(cause instanceof Error?cause.message:'发送异常入口读取失败。');}
  };
  const openCustomerException=(card:AgentCalendarTask)=>{try{if(!recoveryScope||getToken()!==recoveryToken)throw Error('当前登录或周包已变化。');const target=validCustomerExceptionTarget(card,recoveryScope);if(!target)throw Error('补齐卡片与当前周范围不一致。');const item=customerExceptions?.identity===recoveryIdentity?customerExceptions.items.find(r=>r.requestId===target.requestId&&r.scope.runId===target.runId&&r.itemId===target.itemId&&r.memberId===target.memberId):null;if(!item)throw Error('原补齐请求尚未读取。');const node=document.getElementById(customerExceptionPanelId(item));if(!node||node.dataset.tenantId!==target.tenantId||node.dataset.programId!==target.programId||node.dataset.packageId!==target.packageId||node.dataset.packageVersion!==String(target.packageVersion)||node.dataset.runId!==target.runId||node.dataset.requestId!==target.requestId)throw Error('原补齐处理页面尚未读取。');node.scrollIntoView({behavior:'smooth',block:'start'});node.focus({preventScroll:true});}catch(cause){setBindingContext(currentSelection.current);setBindingError(cause instanceof Error?cause.message:'补齐入口读取失败。');}};
  const openPublicationRecovery=(card:AgentCalendarTask)=>{try{if(!recoveryScope||getToken()!==recoveryToken)throw Error('当前登录或周包已变化。');const target=validPublicationRecoveryTarget(card,recoveryScope);if(!target)throw Error('发布异常任务与当前周包不一致。');const node=document.getElementById(publicationRecoveryPanelId(recoveryScope,target.id));if(!node||node.dataset.tenant!==target.tenantId||node.dataset.task!==target.taskId||node.dataset.publication!==target.publicationTaskId||node.dataset.attempt!==target.attemptId)throw Error('原发布处理记录尚未读取。');node.scrollIntoView({behavior:'smooth',block:'start'});node.focus({preventScroll:true});}catch(cause){setBindingContext(currentSelection.current);setBindingError(cause instanceof Error?cause.message:'发布处理入口读取失败。');}};
  const openCustomerExecution=async(actual:WeeklyExecutionTask)=>{const captured=currentSelection.current,token=getToken();try{
    if(!token||!pkg||!recoveryScope||getToken()!==recoveryToken)throw Error('当前登录或周包已变化，请登录后刷新。');
    const matches=scopedTasks.filter(task=>task.taskId===actual.taskId&&task.tenantId===recoveryScope.tenantId&&task.programId===pkg.programId&&task.packageId===pkg.packageId&&task.packageVersion===pkg.version&&task.publicationTaskId===actual.publicationTaskId&&task.schedule.responsibleActor==='customer_agent'&&['customer_channel_readiness','customer_inquiry_handoff'].includes(task.schedule.stepKind)&&task.inputSnapshot.customerChannel===actual.inputSnapshot.customerChannel);
    if(matches.length!==1)throw Error('真实客服执行任务尚未读取或身份已变化，请刷新。');
    setSelectedCustomerExecution({selection:currentSelection.current,taskId:actual.taskId});
    setTimeout(()=>document.getElementById('weekly-calendar-customer-execution')?.scrollIntoView({behavior:'smooth',block:'start'}),0);
    setSelectedCustomerRun(null);
    const projection=await socialProgramApi.readCustomerCalendar(pkg.programId,pkg.packageId,pkg.version);
    if(currentSelection.current!==captured||getToken()!==token)return;
    setSelectedCustomerRun({selection:captured,taskId:actual.taskId,token,projection});
  }catch(cause){if(currentSelection.current!==captured||getToken()!==token)return;setBindingContext(captured);setBindingError(cause instanceof Error?cause.message:'客服执行详情读取失败。');}};
  const openPublicationExecution=(card:AgentCalendarTask)=>{try{if(!pkg||!recoveryScope||getToken()!==recoveryToken)throw Error('当前登录或周包已变化。');const actual=validPublicationExecutionTarget(card,{programId:pkg.programId,packageId:pkg.packageId,packageVersion:pkg.version},scopedTasks);if(!actual)throw Error('发布执行卡与当前真实任务不一致。');setSelectedPublicationExecution({selection:currentSelection.current,taskId:actual.taskId});setTimeout(()=>{const node=document.getElementById(publicationExecutionPanelId(recoveryScope,actual.taskId));if(node)node.scrollIntoView({behavior:'smooth',block:'start'});},0);}catch(cause){setBindingContext(currentSelection.current);setBindingError(cause instanceof Error?cause.message:'发布执行详情读取失败。');}};
  const selectRevision=(next:WeeklyOperatingPackage,expected=JSON.stringify([program?.programId,selected]))=>{
    if(currentSelection.current!==expected)return false;
    if(!pkg||next.programId!==pkg.programId||next.packageId!==pkg.packageId||next.version<=pkg.version)throw Error('新修订与当前项目、周包或版本不一致，请刷新真实排期。');
    currentSelection.current=JSON.stringify([program?.programId,identity(next)]);
    setPackages(current=>[...current.filter(item=>!(item.packageId===next.packageId&&item.version===next.version)),next]);setSelected(identity(next));setTasks([]);return true;
  };
  async function selectProfilePackage(next:WeeklyOperatingPackage,proposal:WeeklyProfileUpgrade,intent:WeeklyProfileCreationIntent){
    const captured=currentSelection.current,token=getToken(),source=recoveryScope;
    if(!source||!pkg||next.packageId===pkg.packageId||next.programId!==source.programId||next.version!==1)throw Error('下一周必须为当前来源周确认的全新任务包。');
    const actual=await socialProgramApi.getOperatingPackage(source.programId,next.packageId);
    if(currentSelection.current!==captured||getToken()!==token)throw Error('来源周或登录已变化，请只读查回已创建的新周包。');
    const checked=parseWeeklyProfileCreation(actual,source,proposal,intent);
    if(!checked||checked.status!=='draft')throw Error('实际新周草稿与原创建意图不一致。');
    taskReadGeneration.current++;currentSelection.current=JSON.stringify([source.programId,identity(checked)]);
    setPackages(items=>[...items.filter(item=>!(item.packageId===checked.packageId&&item.version===checked.version)),checked]);
    setSelected(identity(checked));setTasks([]);setScheduleOutcome(null);window.dispatchEvent(new Event('lingshu:agent-business-refresh'));
  }
  async function selectFeedbackRevision(next: WeeklyOperatingPackage) {
    const captured = currentSelection.current;
    if (!program || next.programId !== program.programId || !next.socialContentPackage.publicationTasks.some(publication => publication.customerFeedbackTopicRef)) throw Error('反馈选题修订与当前经营项目不一致。');
    const actual = await socialProgramApi.getOperatingPackage(next.programId, next.packageId);
    if (currentSelection.current !== captured) throw Error('已切换周包，请回到目标周查看已保存的选题修订。');
    const references = (item: WeeklyOperatingPackage) => item.socialContentPackage.publicationTasks.map(publication => [publication.publicationTaskId, publication.customerFeedbackTopicRef ?? null]);
    if (actual.programId !== next.programId || actual.packageId !== next.packageId || actual.version !== next.version || JSON.stringify(references(actual)) !== JSON.stringify(references(next))) throw Error('实际目标周已变化，请刷新核验选题引用。');
    taskReadGeneration.current++;
    currentSelection.current = JSON.stringify([program.programId, identity(actual)]);
    setPackages(items => [...items.filter(item => !(item.packageId === actual.packageId && item.version === actual.version)), actual]);
    setSelected(identity(actual)); setTasks([]); setScheduleOutcome(null);
    window.dispatchEvent(new Event('lingshu:agent-business-refresh'));
  }
  async function selectTemplateRevision(next: WeeklyOperatingPackage) {
    const captured = currentSelection.current;
    if (!program || next.programId !== program.programId || !next.socialContentPackage.publicationTasks.some(publication => publication.contentTemplateBindingRef)) throw Error('模板修订与当前经营项目不一致。');
    const actual = await socialProgramApi.getOperatingPackage(next.programId, next.packageId);
    if (currentSelection.current !== captured) throw Error('已切换周包，请回到目标周查看已保存的模板修订。');
    const references = (item: WeeklyOperatingPackage) => item.socialContentPackage.publicationTasks.map(publication => [publication.publicationTaskId, publication.contentTemplateBindingRef ?? null]);
    if (actual.programId !== next.programId || actual.packageId !== next.packageId || actual.version !== next.version || actual.status !== 'draft' || JSON.stringify(references(actual)) !== JSON.stringify(references(next))) throw Error('实际目标周已变化，请刷新核验模板绑定。');
    taskReadGeneration.current++;
    currentSelection.current = JSON.stringify([program.programId, identity(actual)]);
    setPackages(items => [...items.filter(item => !(item.packageId === actual.packageId && item.version === actual.version)), actual]);
    setSelected(identity(actual)); setTasks([]); setScheduleOutcome(null);
    window.dispatchEvent(new Event('lingshu:agent-business-refresh'));
  }
  async function recheckRequiredMaterialTask(task:WeeklyExecutionTask){
    if(!pkg||materialRecoveryBusy||task.programId!==pkg.programId||task.packageId!==pkg.packageId||task.packageVersion!==pkg.version||task.status!=='blocked'||!task.ownBlockingReasons.includes('weekly_required_materials_missing'))return;
    const captured=currentSelection.current,token=getToken();setMaterialRecoveryBusy(task.taskId);setBindingContext(captured);setBindingError('');
    try{const items=await socialProgramApi.recheckRequiredMaterials(pkg.programId,pkg.packageId,task.taskId,pkg.version);if(currentSelection.current!==captured||getToken()!==token)return;const exact=items.filter(item=>item.taskId===task.taskId&&item.tenantId===task.tenantId&&item.programId===pkg.programId&&item.packageId===pkg.packageId&&item.packageVersion===pkg.version);if(exact.length!==1||exact[0]!.ownBlockingReasons.includes('weekly_required_materials_missing'))throw Error('原任务素材恢复回执不一致，请刷新真实证据。');await reloadAfterEvidenceResume(exact[0]!);}
    catch(cause){if(currentSelection.current===captured&&getToken()===token){setBindingContext(captured);setBindingError(cause instanceof Error?cause.message:'原任务素材重新核验失败。');}}
    finally{setMaterialRecoveryBusy(null);}
  }
  async function reloadAfterEvidenceResume(actual:WeeklyExecutionTask){if(!pkg||actual.programId!==pkg.programId||actual.packageId!==pkg.packageId||actual.packageVersion!==pkg.version||!scopedTasks.some(task=>task.taskId===actual.taskId&&task.tenantId===actual.tenantId))throw Error('恢复回执与当前真实执行任务不一致。');const captured=currentSelection.current,token=getToken();const generation=++taskReadGeneration.current;const [refreshed,actualPackage]=await Promise.all([socialProgramApi.listExecutionTasks(pkg.programId,pkg.packageId,pkg.version),socialProgramApi.getOperatingPackage(pkg.programId,pkg.packageId)]);if(refreshed.some(task=>task.programId!==pkg.programId||task.packageId!==pkg.packageId||task.packageVersion!==pkg.version||task.tenantId!==actual.tenantId)||actualPackage.programId!==pkg.programId||actualPackage.packageId!==pkg.packageId||actualPackage.version!==pkg.version)throw Error('恢复后的执行任务或周包版本已变化，请核验实际新修订。');if(currentSelection.current!==captured||taskReadGeneration.current!==generation||getToken()!==token)return;setPackages(items=>items.map(item=>item.programId===actualPackage.programId&&item.packageId===actualPackage.packageId&&item.version===actualPackage.version?actualPackage:item));setTasks(refreshed);window.dispatchEvent(new Event('lingshu:agent-business-refresh'));}
  async function bindMaterial(request:WeeklyMaterialRequest,bindings:WeeklyHumanMaterialBinding[]=retryBindings){
    if(!pkg||!program)throw Error('当前经营项目或周包尚未读取，素材未关联。');
    if(bindingBusy)throw Error('已有素材关联正在核验，请等待结果后修复同一请求。');
    let operationIdentity=JSON.stringify([program.programId,selected]);setBindingBusy(true);setBindingContext(operationIdentity);setBindingError('');setRetryRequest(null);
    try{await bindWeeklyMaterialRequest({pkg,tasks:scopedTasks,request,bindings,onRevision:next=>{
      if(selectRevision(next,operationIdentity))operationIdentity=currentSelection.current;
    }});if(currentSelection.current===operationIdentity)window.dispatchEvent(new Event('lingshu:agent-business-refresh'));}
    catch(cause){if(currentSelection.current===operationIdentity){setBindingContext(operationIdentity);setBindingError(cause instanceof Error?cause.message:'素材关联失败，请核验真实消费者。');setRetryRequest(request);setRetryBindings(bindings);}throw cause;}
    finally{setBindingBusy(false);}
  }
  const openMaterial=(requestId:string,action?:'upload'|'verification')=>{if(!pkg)return;if(!openMaterialPanelRequest(materialPanel.current,pkg.programId,pkg.packageId,pkg.version,requestId,action)){setBindingContext(currentSelection.current);setBindingError('对应素材任务仍在加载或尚未关联此版本，请在下方真实素材工作区核验。');}};
  async function openContent(card:AgentCalendarTask,chosen?:ScopedSceneTarget){
    if(!pkg)return;
    const selection=currentSelection.current,generation=++sceneReadGeneration.current,token=getToken();const stillCurrent=()=>currentSelection.current===selection&&sceneReadGeneration.current===generation&&getToken()===token;
    setBindingContext(selection);setBindingError('');setSceneChoices(null);setSceneUpstream(null);setSceneReading(selection);
    try{
      const actualTasks=await socialProgramApi.listExecutionTasks(pkg.programId,pkg.packageId,pkg.version);
      const executionTaskId=card.productionExecutionTaskId||card.id;
      const currentTask=actualTasks.filter(t=>t.taskId===executionTaskId&&t.programId===pkg.programId&&t.packageId===pkg.packageId&&t.packageVersion===pkg.version);
      if(currentTask.length===1&&stillCurrent())setSceneUpstream({selection,tasks:actualTasks.filter(t=>currentTask[0]!.dependsOnTaskIds.includes(t.taskId)&&t.tenantId===currentTask[0]!.tenantId&&t.programId===pkg.programId&&t.packageId===pkg.packageId&&t.packageVersion===pkg.version)});
      if(!stillCurrent())return;
      if(currentTask.length!==1)throw Error('当前周任务身份不唯一，请刷新。');
      const selectedExecution=currentTask[0]!;
      if(!isSceneContentExecution(selectedExecution)||!['blocked','dead_letter'].includes(selectedExecution.status)||!selectedExecution.productionProgress?.runId){if(chosen)throw Error('原受阻任务已变化，请重新读取。');const binding=await readWeeklyContentNavigation({tenantId:selectedExecution.tenantId,programId:pkg.programId,packageId:pkg.packageId,packageVersion:pkg.version,executionTaskId:selectedExecution.taskId});if(binding.publicationTaskId!==selectedExecution.publicationTaskId)throw Error('内容绑定与当前发布条目不一致。');if(stillCurrent())window.dispatchEvent(new CustomEvent('lingshu:navigate',{detail:weeklyContentNavigationDetail(binding)}));return;}
      const actual=sceneCalendarExecution(pkg,actualTasks,card);
      const [content,projects]=await Promise.all([socialContentApi.getTask(actual.productionProgress!.contentTaskId),studioApi.listProjects({throwOnError:true})]);
      if(content.taskId!==actual.productionProgress!.contentTaskId||content.runId!==actual.productionProgress!.runId||content.brief.programRef?.id!==actual.programId||content.agentWorkflow?.weeklyPackage?.packageId!==actual.packageId||content.agentWorkflow?.weeklyPackage?.version!==String(actual.packageVersion))throw Error('内容任务与当前执行身份、项目或周包版本不一致，请核对原周上游。');
      const parents=content.artifacts.filter(a=>a.taskId===content.taskId&&a.origin==='agent'&&a.kind==='short_video');
      if(!parents.length){if(chosen)throw Error('原成片尚不存在，不能定位失败分镜。');const binding=await readWeeklyContentNavigation({tenantId:actual.tenantId,programId:pkg.programId,packageId:pkg.packageId,packageVersion:pkg.version,executionTaskId:actual.taskId});if(binding.artifactRef||binding.contentTaskId!==content.taskId||binding.runId!==content.runId)throw Error('原生产状态已变化，请重新读取任务。');if(stillCurrent())window.dispatchEvent(new CustomEvent('lingshu:navigate',{detail:weeklyContentNavigationDetail(binding)}));return;}
      const reads=await Promise.allSettled(parents.map(a=>socialSceneReworkApi.availability({tenantId:actual.tenantId,taskId:content.taskId,sourceRunId:actual.productionProgress!.runId!,parentArtifactId:a.artifactId})));
      const receipts=reads.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
      if(reads.some(r=>r.status==='rejected'))throw Error('部分原成片逐镜核验凭据无法读取，不能完整定位失败对象。'+reads.flatMap(r=>r.status==='rejected'?[String(r.reason)]:[]).join('；'));
      await Promise.all(receipts.map(receipt=>{const bound=projects.filter(p=>p.id===receipt.productionWorkspaceBinding?.projectId);if(bound.length!==1)throw Error(receipt.productionWorkspaceGap||`原成片 ${receipt.parentArtifactId} 缺少唯一已核验的视频项目血缘。`);return verifyProductionSnapshotHash(receipt,bound[0]!);}));
      const items=sceneCalendarChoices(actual,content,projects,receipts);
      if(!stillCurrent())return;
      if(chosen){const exact=items.filter(item=>JSON.stringify(item.target)===JSON.stringify(chosen));if(exact.length!==1)throw Error('所选成片或失败分镜已变化，请重新读取原任务。');window.dispatchEvent(new CustomEvent('lingshu:navigate',{detail:sceneStudioNavigationDetail(exact[0]!.target)}));}
      else if(items.length===1)window.dispatchEvent(new CustomEvent('lingshu:navigate',{detail:sceneStudioNavigationDetail(items[0]!.target)}));
      else setSceneChoices({selection,generation,card,items});
    }catch(cause){if(stillCurrent()){setBindingContext(selection);setBindingError(cause instanceof Error?cause.message:'真实生产对象读取失败，请核对原周任务上游。');}}
    finally{if(sceneReadGeneration.current===generation)setSceneReading(null);}
  }
  if (!program) return accountBindingTasks.length ? <AgentWeeklyCalendar tasks={accountBindingTasks} startsAt={accountBindingTasks[0]?.date} onBindAccount={()=>window.dispatchEvent(new CustomEvent('lingshu:navigate',{detail:{page:'accountManagement'}}))}/> : <p className="p-6 text-sm text-slate-500">请先选择社媒经营项目，再查看真实 Agent 周任务排期。</p>;
  return <div>
    <div className="flex flex-wrap items-center gap-3 px-6 pt-5 text-xs">
      <span className="font-bold text-slate-700">经营项目：{program.brandName}</span>
      <select aria-label="查看周任务包版本" value={selected} onChange={event => setSelected(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
        <option value="">请选择周任务包</option>
        {packages.map(item => <option key={identity(item)} value={identity(item)}>{item.weekStart} · v{item.version} · {item.objective}</option>)}
      </select>
      {pkg?.referenceSourcePolicy && <span>自有 {pkg.referenceSourcePolicy.ownedPercent}% / 外部 {pkg.referenceSourcePolicy.externalPercent}% · 按母版</span>}
    </div>
    {loading && <p className="p-6 text-xs text-slate-500">正在读取真实执行排期…</p>}
    {error && <p role="alert" className="m-6 rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</p>}
    {!loading && !error && pkg && <WeeklyCustomerCalendar onOpenExecutionTask={openCustomerExecution} sendRecoveries={sendRecoveries?.identity===recoveryIdentity?sendRecoveries.items:[]} onOpenSendRecovery={openSendRecovery} programId={pkg.programId} packageId={pkg.packageId} packageVersion={pkg.version} weekStart={pkg.weekStart} weekEnd={pkg.weekEnd} executionTasks={scopedTasks} onOpenSales={card=>{try{if(!recoveryScope||getToken()!==recoveryToken)throw Error('当前登录或周包已变化。');revealWeeklySalesAction(card,recoveryScope,salesPanel.current);}catch(cause){setBindingContext(currentSelection.current);setBindingError(cause instanceof Error?cause.message:'真实销售交接入口尚未加载。');}}} onOpenMaterial={openMaterial} onOpenTemplate={task=>{try{const actual=revealWeeklyTemplateTask({pkg,tasks:scopedTasks,task});setSelectedTemplate({selection:currentSelection.current,taskId:actual.taskId});}catch(cause){setBindingContext(currentSelection.current);setBindingError(cause instanceof Error?cause.message:'模板入口尚未加载，请刷新真实任务。');}}} onOpenReview={task=>{try{const actual=revealWeeklyReviewTask({pkg,tasks:scopedTasks,task});setSelectedReview({selection:currentSelection.current,taskId:actual.taskId});}catch(cause){setBindingContext(currentSelection.current);setBindingError(cause instanceof Error?cause.message:'观察或复盘入口尚未加载，请刷新。');}}} onOpenPlanning={task=>{try{revealWeeklyPlanningTask({pkg,tasks:scopedTasks,task});}catch(cause){setBindingContext(currentSelection.current);setBindingError(cause instanceof Error?cause.message:'规划入口尚未加载，请刷新真实任务。');}}} onOpenSupplement={card=>{try{const target=card.supplementTarget;if(!target||supplements?.selection!==currentSelection.current)throw Error('补齐任务仍在加载，请刷新真实任务。');const matches=supplements.items.filter(item=>item.requestId===target.requestId&&item.tenantId===target.tenantId&&item.programId===pkg.programId&&item.packageId===pkg.packageId&&item.packageVersion===pkg.version);if(matches.length!==1||target.programId!==pkg.programId||target.packageId!==pkg.packageId||target.packageVersion!==pkg.version||!['submission','verification'].includes(target.action)||card.id!==`supplement:${target.requestId}:${target.action}`)throw Error('补齐任务身份不一致。');const item=matches[0]!;const node=document.getElementById(supplementPanelRequestId(item));if(!node||node.dataset.supplementTenant!==item.tenantId||node.dataset.supplementProgram!==item.programId||node.dataset.supplementPackage!==item.packageId||node.dataset.supplementVersion!==String(item.packageVersion)||node.dataset.supplementRequest!==item.requestId)throw Error('真实补齐工作区尚未加载，请刷新。');node.scrollIntoView({behavior:'smooth',block:'start'});node.focus({preventScroll:true});}catch(cause){setBindingContext(currentSelection.current);setBindingError(cause instanceof Error?cause.message:'补齐入口尚未加载。');}}} mainTasks={[...accountBindingTasks,...(recoveryScope?projectCrossWeekMaterials(crossWeekMaterials?.identity===recoveryIdentity?crossWeekMaterials.items:[],recoveryScope):[]),...(recoveryScope?projectCustomerExceptions(customerExceptions?.identity===recoveryIdentity?customerExceptions.items:[],recoveryScope):[]),...(recoveryScope?projectPublicationRecoveries(publicationRecoveries?.identity===recoveryIdentity?publicationRecoveries.items:[],recoveryScope):[]),...(recoveryScope?projectNativeRecoveries(nativeRecoveries?.identity===recoveryIdentity?nativeRecoveries.items:[],recoveryScope):[]),...projectExecutionCalendar(scopedTasks, STEP_LABEL, Date.now(), {pkg, profile:pkg.referenceSourcePolicy?.profile==='b2b_established'?'account_repair':pkg.referenceSourcePolicy?.profile==='b2b_cold_start'?'cold_start':program.route}),...projectWeeklySupplementRequests(supplements?.selection===currentSelection.current?supplements.items:[],{programId:pkg.programId,packageId:pkg.packageId,packageVersion:pkg.version})]} onOpenContent={task => {if(task.inventoryTarget){try{const target=task.inventoryTarget;if(!recoveryScope||getToken()!==recoveryToken||task.id!==target.taskId||Object.entries(recoveryScope).some(([k,v])=>target[k as keyof typeof target]!==v))throw Error('\u5e93\u5b58\u4efb\u52a1\u8eab\u4efd\u4e0d\u4e00\u81f4');const node=document.getElementById(`inventory-workspace:${target.tenantId}:${target.programId}:${target.packageId}:${target.packageVersion}:${target.bindingId}`);if(!node||node.dataset.publication!==target.publicationTaskId)throw Error('\u771f\u5b9e\u5e93\u5b58\u8bb0\u5f55\u5c1a\u672a\u8bfb\u53d6');node.scrollIntoView({behavior:'smooth',block:'start'});node.focus({preventScroll:true});}catch(e){setBindingContext(currentSelection.current);setBindingError(e instanceof Error?e.message:String(e));}return;}if(task.crossWeekMaterialTarget){try{if(!recoveryScope||getToken()!==recoveryToken)throw Error('当前登录或周包已变化。');const target=validCrossWeekMaterialTarget(task,recoveryScope);if(!target)throw Error('跨周核验卡身份不一致。');const node=document.getElementById(crossWeekMaterialPanelId(recoveryScope,target.continuationId));if(!node||node.dataset.request!==target.requestId||node.dataset.consumer!==target.consumerTaskId)throw Error('真实跨周衔接记录尚未读取。');node.scrollIntoView({behavior:'smooth',block:'start'});node.focus({preventScroll:true});}catch(e){setBindingContext(currentSelection.current);setBindingError(e instanceof Error?e.message:'跨周入口读取失败。');}return;}if(task.customerExceptionTarget){openCustomerException(task);return;}if(task.publicationRecoveryTarget){openPublicationRecovery(task);return;}if(task.publicationExecutionTarget){openPublicationExecution(task);return;}if(task.nativeRecoveryTarget){try{if(!recoveryScope||getToken()!==recoveryToken)throw Error('当前登录或周包已变化。');const target=validNativeRecoveryTarget(task,recoveryScope);if(!target)throw Error('人工任务与当前周范围不一致。');const node=document.getElementById(nativeRecoveryPanelId(recoveryScope,target.id));if(!node||node.dataset.tenant!==target.tenantId||node.dataset.run!==target.runId||node.dataset.task!==target.taskId||node.dataset.request!==target.requestId||node.dataset.channel!==target.channel)throw Error('原人工处理任务尚未读取。');node.scrollIntoView({behavior:'smooth',block:'start'});node.focus({preventScroll:true});}catch(cause){setBindingContext(currentSelection.current);setBindingError(cause instanceof Error?cause.message:'人工处理入口读取失败。');}return;}void openContent(task);}} />}
    {pkg&&selectedCustomerExecution?.selection===currentSelection.current&&<section id="weekly-calendar-customer-execution" aria-label="真实客服承接任务" className="mx-6 my-4 rounded-xl border p-4">{(()=>{
      const actual=scopedTasks.find(task=>task.taskId===selectedCustomerExecution.taskId);
      if(!actual)return <p role="alert">真实客服执行目标已变化，请刷新任务日历。</p>;
      return <><h3 className="font-bold">{STEP_LABEL[actual.schedule.stepKind]} · {String(actual.inputSnapshot.customerChannel)}</h3><p className="mt-2 text-xs">真实任务：{actual.taskId} · 发布：{actual.publicationTaskId} · 周包 v{actual.packageVersion}</p><p className="mt-2 text-sm">当前状态：{actual.status}</p>{actual.ownBlockingReasons.map(reason=><p key={reason} className="text-sm text-amber-800">{reason}</p>)}{actual.lastError&&<p role="alert" className="text-sm text-red-700">{actual.lastError.message}</p>}<p className="mt-2 text-xs">真实结果引用：{actual.resultRefs.length?actual.resultRefs.map(ref=>JSON.stringify(ref)).join('、'):'尚无核验交付'}</p><p className="mt-2 text-xs text-slate-500">客服运行的逐客草稿、审批和回执，请从下方本周已绑定运行的对应步骤进入。</p>{selectedCustomerRun?.selection===currentSelection.current&&selectedCustomerRun.token===getToken()&&selectedCustomerRun.taskId===actual.taskId?(selectedCustomerRun.projection.binding?selectedCustomerRun.projection.tasks.map(task=><button type="button" key={task.taskId} className="mt-2 block rounded border px-3 py-2 text-xs" onClick={()=>{const bound=selectedCustomerRun.projection.binding;if(selectedCustomerRun.selection!==currentSelection.current||getToken()!==selectedCustomerRun.token||!bound){setBindingContext(currentSelection.current);setBindingError('客服运行绑定已变化，请刷新。');return;}openCustomerCalendarTask(bound.runId,task);}}>{task.title} · {task.status} · 进入真实客服运行步骤</button>):<p role="alert" className="mt-2 text-sm text-amber-800">本周尚未绑定真实客服运行，暂无法进入逐客生产实况。</p>):<p className="mt-2 text-xs">正在核验本周客服运行绑定；读取失败时请根据错误提示刷新。</p>}</>;
    })()}</section>}
    {pkg&&bindingError&&bindingContext===currentSelection.current&&sceneUpstream?.selection===currentSelection.current&&sceneUpstream.tasks.length>0&&<section aria-label="真实上游任务" className="mx-6 rounded border p-3 text-xs"><h4>此任务的真实上游 · 保留原执行身份</h4>{sceneUpstream.tasks.map(actual=>{const card=projectExecutionCalendar([actual],STEP_LABEL,Date.now(),{pkg,profile:pkg.referenceSourcePolicy?.profile==='b2b_established'?'account_repair':pkg.referenceSourcePolicy?.profile==='b2b_cold_start'?'cold_start':program.route})[0];return <div key={actual.taskId} className="my-2"><p>{STEP_LABEL[actual.schedule.stepKind]} · {actual.taskId} · {actual.status}</p>{card?.planningTarget&&<button type="button" onClick={()=>{try{revealWeeklyPlanningTask({pkg,tasks:scopedTasks,task:card});}catch(e){setBindingError(String(e));}}}>查看真实编导上游</button>}{actual.workflowKind==='content'&&<button type="button" onClick={()=>{if(card)void openContent(card);}}>核对该上游内容对象</button>}</div>;})}</section>}
    {sceneReading===currentSelection.current&&<p role="status" className="mx-6 p-3 text-xs">正在读取此执行任务的真实视频、成片与失败分镜…</p>}
    {sceneChoices?.selection===currentSelection.current&&<section aria-label="选择真实失败分镜" className="mx-6 rounded-xl border p-4"><h3>此任务存在多个真实处理对象，请选择要定位的失败分镜</h3>{sceneChoices.items.map(item=><button type="button" key={JSON.stringify(item.target)} className="my-2 block w-full rounded border p-3 text-left text-xs" onClick={()=>{if(sceneChoices.selection!==currentSelection.current||sceneChoices.generation!==sceneReadGeneration.current)return;void openContent(sceneChoices.card,item.target);}}>{item.label}{item.reasons.map((reason,i)=><p key={i}>{reason}</p>)}</button>)}</section>}
    {pkg&&bindingContext===currentSelection.current&&bindingError&&<p role="alert" className="mx-6 my-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{bindingError}{retryRequest&&<button type="button" disabled={bindingBusy} onClick={()=>void bindMaterial(retryRequest).catch(()=>{})} className="ml-3 underline disabled:opacity-40">{bindingBusy?'正在核验关联…':'修复同一素材的冻结排期关联'}</button>}</p>}
    {pkg&&scheduleOutcome?.item.programId===program.programId&&scheduleOutcome.item.packageId===pkg.packageId&&scheduleOutcome.item.version===pkg.version&&<section className="mx-6 my-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900"><strong>容量倒排已确认 · 真实新草稿 v{scheduleOutcome.item.version}</strong><p className="mt-1">新版本尚未激活；发布时刻已保留。{scheduleOutcome.previousPublishingAuthorizationRevoked?'原版本发布授权已撤销，需要核验新版本后再明确激活和授权。':'原版本没有被本次操作撤销的发布授权。'}</p>{scheduleOutcome.materialConsumerRepairs.length>0&&<div className="mt-2 text-amber-900"><strong>必需素材消费者仍需修复，生产保持阻塞：</strong>{scheduleOutcome.materialConsumerRepairs.map((issue,i)=><p key={`${issue.requestId}:${i}`}>{issue.requestId} · {issue.reason}</p>)}</div>}</section>}
    {!loading&&!error&&pkg&&<div className="px-6 pb-4"><AgentOperatingControls pkg={pkg} tasks={scopedTasks} programRoute={program.route??null} onFeedbackRevision={selectFeedbackRevision} onPlanningChanged={async next=>{const captured=currentSelection.current;taskReadGeneration.current++;if(next.programId!==pkg.programId||next.packageId!==pkg.packageId||next.version!==pkg.version||!next.agentPlanning||next.agentPlanning.version<=(pkg.agentPlanning?.version??0))throw Error('规划更新必须来自当前同版本周包且规划版本真实递增。');setTasksLoading(true);try{const actual=await socialProgramApi.listExecutionTasks(next.programId,next.packageId,next.version);if(actual.some(t=>t.programId!==next.programId||t.packageId!==next.packageId||t.packageVersion!==next.version))throw Error('更新后的执行任务身份不一致。');if(currentSelection.current!==captured)return;setPackages(items=>items.map(item=>item.programId===next.programId&&item.packageId===next.packageId&&item.version===next.version?next:item));setTasks(actual);window.dispatchEvent(new Event('lingshu:agent-business-refresh'));}finally{if(currentSelection.current===captured)setTasksLoading(false);}}} onRevision={next=>{selectRevision(next);}} onScheduleConfirmed={result=>{if(result.snapshot.programId!==pkg.programId||result.snapshot.packageId!==pkg.packageId||result.snapshot.sourceVersion!==pkg.version||result.snapshot.targetVersion!==result.item.version||result.item.programId!==pkg.programId||result.item.packageId!==pkg.packageId)throw Error('确认回执与当前项目、周包或版本不一致，请核验真实修订。');if(selectRevision(result.item))setScheduleOutcome(result);}}/></div>}
    {!loading&&!error&&pkg&&<div className="px-6 pb-6"><WeeklyCustomerChannelScopePanel key={`${pkg.programId}:${pkg.packageId}:${pkg.version}`} programId={pkg.programId} packageId={pkg.packageId} packageVersion={pkg.version}/></div>}
    {!loading&&!error&&pkg&&<div ref={materialPanel} className="px-6 pb-6"><WeeklyMaterialRequestsPanel pkg={pkg} programId={pkg.programId} packageId={pkg.packageId} packageVersion={pkg.version} tasks={scopedTasks} requiredRequestIds={[...new Set(pkg.socialContentPackage.publicationTasks.flatMap(item=>item.materialRequirement?.requestIds??[]))]} onBindRequiredRequests={bindMaterial}/>{scopedTasks.filter(task=>task.status==='blocked'&&task.ownBlockingReasons.includes('weekly_required_materials_missing')).map(task=><button key={task.taskId} type="button" disabled={!!materialRecoveryBusy} className="mt-2 mr-2 rounded-lg border px-3 py-2 text-xs disabled:opacity-50" onClick={()=>void recheckRequiredMaterialTask(task)}>{materialRecoveryBusy===task.taskId?'正在核验真实素材…':`重新核验素材并恢复：${STEP_LABEL[task.schedule.stepKind]} · ${task.publicationTaskId||task.taskId}`}</button>)}</div>}
    {!loading&&!error&&pkg&&recoveryScope&&pkg.referenceSourcePolicy?.profile==='b2b_established'&&<div className="px-6 pb-6"><WeeklyInventoryReusePanel key={recoveryIdentity} {...recoveryScope} pkg={pkg} onRevision={next=>{selectRevision(next);}}/></div>}
    {!loading&&!error&&pkg&&recoveryScope&&pkg.referenceSourcePolicy?.profile==='b2b_cold_start'&&<div className="px-6 pb-6"><WeeklyProfileUpgradePanel key={recoveryIdentity} {...recoveryScope} onCreated={selectProfilePackage}/></div>}
    {!loading&&!error&&pkg&&recoveryScope&&<div className="px-6 pb-6"><CrossWeekMaterialContinuationPanel key={recoveryIdentity} {...recoveryScope} onOpenMaterial={openMaterial} onChanged={items=>{if(sendRecoveryIdentity.current===recoveryIdentity&&getToken()===recoveryToken)setCrossWeekMaterials({identity:recoveryIdentity,items});}}/></div>}
    {!loading&&!error&&pkg&&recoveryScope&&<div className="px-6 pb-6"><BoundWeeklyCustomerKnowledgeQuotePanel key={recoveryIdentity} {...recoveryScope} onChanged={items=>{if(sendRecoveryIdentity.current!==recoveryIdentity||getToken()!==recoveryToken)return;setCustomerExceptions({identity:recoveryIdentity,items});}}/></div>}
    {!loading&&!error&&pkg&&recoveryScope&&selectedPublicationExecution?.selection===currentSelection.current&&<div className="px-6 pb-6"><WeeklyPublicationExecutionPanel {...recoveryScope} taskId={selectedPublicationExecution.taskId}/></div>}
    {!loading&&!error&&pkg&&recoveryScope&&<div className="px-6 pb-6"><WeeklyPublicationRecoveryPanel key={recoveryIdentity} {...recoveryScope} onChanged={items=>{if(sendRecoveryIdentity.current!==recoveryIdentity||getToken()!==recoveryToken)return;setPublicationRecoveries({identity:recoveryIdentity,items});}}/></div>}
    {!loading&&!error&&pkg&&recoveryScope&&<div className="px-6 pb-6"><WeeklyNativeSendRecoveryPanel key={recoveryIdentity} {...recoveryScope} onChanged={items=>{if(sendRecoveryIdentity.current!==recoveryIdentity||getToken()!==recoveryToken)return;if(items.some(item=>item.tenantId!==recoveryScope.tenantId||item.programId!==recoveryScope.programId||item.packageId!==recoveryScope.packageId||item.packageVersion!==recoveryScope.packageVersion))throw Error('人工任务与当前周范围不一致。');setNativeRecoveries({identity:recoveryIdentity,items});}}/></div>}
    {!loading&&!error&&pkg&&recoveryScope&&<div className="px-6 pb-6"><WeeklyNativeDispatchPanel key={recoveryIdentity} tenantId={recoveryScope.tenantId} programId={pkg.programId} packageId={pkg.packageId} packageVersion={pkg.version}/></div>}
    {!loading&&!error&&pkg&&recoveryScope&&<div className="px-6 pb-6"><WeeklyCustomerSendRecoveryPanel key={recoveryIdentity} {...recoveryScope} onChanged={items=>{if(sendRecoveryIdentity.current!==recoveryIdentity||getToken()!==recoveryToken)return;if(items.some(item=>item.tenantId!==recoveryScope.tenantId||item.programId!==recoveryScope.programId||item.packageId!==recoveryScope.packageId||item.packageVersion!==recoveryScope.packageVersion))throw Error('发送异常记录与当前真实租户和周包版本不一致。');setSendRecoveries({identity:recoveryIdentity,items});}}/></div>}
    {!loading&&!error&&pkg&&<div ref={salesPanel} className="px-6 pb-6"><WeeklySalesHandoffPanel programId={pkg.programId} packageId={pkg.packageId} packageVersion={pkg.version}/></div>}
    {!loading&&!error&&pkg&&<div className="px-6 pb-6"><WeeklyRunningResourceEvidencePanel pkg={pkg} tasks={scopedTasks}/></div>}
    {!loading&&!error&&pkg&&<div className="px-6 pb-6"><WeeklySupplementRequestsPanel pkg={pkg} tasks={scopedTasks} onExecutionResume={reloadAfterEvidenceResume} onChanged={items=>{if(items.some(item=>item.programId!==pkg.programId||item.packageId!==pkg.packageId||item.packageVersion!==pkg.version||!scopedTasks.some(task=>task.taskId===item.consumerTaskId&&task.tenantId===item.tenantId)))throw Error('补齐任务与实际周包执行身份不一致。');setSupplements({selection:currentSelection.current,items});}}/></div>}
    {!loading&&!error&&pkg&&<div className="px-6 pb-6"><WeeklyReviewEvidencePanel pkg={pkg} tasks={scopedTasks} taskId={selectedReview?.selection===currentSelection.current?selectedReview.taskId:undefined}/></div>}
    {!loading&&!error&&pkg&&<div className="px-6 pb-6"><WeeklyContentTemplatesPanel pkg={pkg} tasks={scopedTasks} taskId={selectedTemplate?.selection===currentSelection.current?selectedTemplate.taskId:undefined} onExecutionResume={reloadAfterEvidenceResume} onTemplateRevision={selectTemplateRevision}/></div>}
    {!loading && !error && !pkg && accountBindingTasks.length>0 && <AgentWeeklyCalendar tasks={accountBindingTasks} startsAt={accountBindingTasks[0]?.date} onBindAccount={()=>window.dispatchEvent(new CustomEvent('lingshu:navigate',{detail:{page:'accountManagement'}}))}/>}
    {!loading && !error && !pkg && <p className="p-6 text-xs text-slate-500">选择已有周包查看排期；无周包时需先生成经营周计划。</p>}
  </div>;
}
