import {readTemplateCarryoverPlans} from '../../lib/weeklyTemplateCarryoverConfirmation';
import { useRef,useState,useEffect } from 'react';
import {AUTH_TOKEN_CHANGED_EVENT,getToken} from '../../lib/auth';
import {createOperatingControlScopeGuard} from '../../lib/operatingControlScopeGuard';
import type { SocialProgramRoute, WeeklyExecutionTask, WeeklyOperatingPackage } from '../../../shared/contracts/socialProgram';
import { createAgentOperatingControlActions } from '../../lib/agentOperatingControlActions';
import PublicationReceptionSetup from './PublicationReceptionSetup';
import WeeklyCustomerRunBinding from './WeeklyCustomerRunBinding';
import WeeklyRecoveryPanel, { buildBackwardScenario,assertTargetGraphCapacity } from './WeeklyRecoveryPanel';
import { socialProgramApi } from '../../lib/socialProgramApi';
import ReferenceSourcePolicySetup from './ReferenceSourcePolicySetup';
import type { WeeklyScheduleConfirmation } from '../../../shared/contracts/socialWeeklyScheduleRevision';
import MaterialEvidenceConfigurationPanel from './MaterialEvidenceConfigurationPanel';
import WeeklyAgentPlanningPanel from './WeeklyAgentPlanningPanel';
import CustomerFeedbackTopicPanel from './CustomerFeedbackTopicPanel';
import {weeklyInitialScheduleApi} from '../../lib/weeklyInitialScheduleApi';

export function offersInitialSchedule(pkg:WeeklyOperatingPackage,tasks:WeeklyExecutionTask[]){return pkg.status==='draft'&&!('scheduleRevisionRef' in pkg)&&!pkg.socialContentPackage.authorization.allowRealPublishing&&tasks.length>0&&tasks.every(t=>t.programId===pkg.programId&&t.packageId===pkg.packageId&&t.packageVersion===pkg.version&&!t.lease&&t.attempt===0&&!t.resultRefs.length&&!t.schedule.actualStartedAt&&!t.schedule.actualFinishedAt&&!t.productionProgress&&['pending_activation','blocked','queued'].includes(t.status));}

export interface AgentOperatingControlsProps {
  pkg: WeeklyOperatingPackage;
  tasks: WeeklyExecutionTask[];
  programRoute: SocialProgramRoute | null;
  onRevision(next: WeeklyOperatingPackage): void;
  onScheduleConfirmed?(result: WeeklyScheduleConfirmation): void;
  onPlanningChanged?(next: WeeklyOperatingPackage): void | Promise<void>;
  onFeedbackRevision?(next: WeeklyOperatingPackage): void | Promise<void>;
}
/** Mounted in the real matrix calendar; configuration never starts a customer run or activates a week. */
export default function AgentOperatingControls({ pkg, tasks, programRoute, onRevision, onScheduleConfirmed, onPlanningChanged, onFeedbackRevision }: AgentOperatingControlsProps) {
  const [authToken,setAuthToken]=useState(getToken);
  const tenantIdentity=[...new Set(tasks.filter(t=>t.programId===pkg.programId&&t.packageId===pkg.packageId&&t.packageVersion===pkg.version).map(t=>t.tenantId))].sort();
  const identity = JSON.stringify([pkg.programId, pkg.packageId, pkg.version,tenantIdentity,authToken]);
  const guard=useRef(createOperatingControlScopeGuard(getToken));guard.current.select(identity,authToken);
  useEffect(()=>{guard.current.mount();const changed=()=>{guard.current.invalidate();setAuthToken(getToken());};window.addEventListener(AUTH_TOKEN_CHANGED_EVENT,changed);window.addEventListener('storage',changed);return()=>{guard.current.unmount();window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT,changed);window.removeEventListener('storage',changed);};},[]);
  const current = useRef(identity); current.current = identity;
  const effectiveRoute:SocialProgramRoute|null=pkg.referenceSourcePolicy?.profile==='b2b_established'?'account_repair':pkg.referenceSourcePolicy?.profile==='b2b_cold_start'?'cold_start':programRoute;
  const scoped = tasks.filter(task => task.programId === pkg.programId && task.packageId === pkg.packageId && task.packageVersion === pkg.version);
  const requireScopedTenant=()=>{const tenants=[...new Set(scoped.map(task=>task.tenantId))];if(tenants.length!==1||typeof tenants[0]!=='string'||!tenants[0])throw Error('当前周包缺少唯一真实租户任务身份，请重新读取。');return tenants[0];};
  const actions = createAgentOperatingControlActions(pkg, scoped);
  const initial=offersInitialSchedule(pkg,scoped);
  const initialScope=()=>({tenantId:requireScopedTenant(),programId:pkg.programId,packageId:pkg.packageId,packageVersion:pkg.version});
  const previewGraph=async()=>initial?(await weeklyInitialScheduleApi.preview(initialScope())).graph:await socialProgramApi.previewScheduleTargetGraph(pkg.programId,pkg.packageId,pkg.version,requireScopedTenant());
  return <section aria-label="本周真实经营配置" className="space-y-3">
    <div className="rounded-xl border border-stone-200 bg-white p-4"><h3 className="text-sm font-semibold">本周经营配置 · v{pkg.version}</h3><p className="mt-1 text-xs text-stone-500">承接条件修订保存为新周版本。客服选择仅绑定已有真实运行；补救评估不直接改排期。</p></div>
    {onPlanningChanged && <details className="rounded-xl border border-stone-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">分析参考、核对排期与正式派单</summary><WeeklyAgentPlanningPanel key={`planning:${identity}:${pkg.agentPlanning?.version}`} pkg={pkg} tasks={scoped} onChanged={onPlanningChanged} /></details>}
    {onFeedbackRevision && <details className="rounded-xl border border-stone-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">把真实买家问题转为下周选题</summary><CustomerFeedbackTopicPanel key={`feedback:${identity}`} pkg={pkg} onRevision={onFeedbackRevision} /></details>}
    <details className="rounded-xl border border-stone-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">确认爆款复刻来源配额</summary><ReferenceSourcePolicySetup key={`sources:${identity}`} pkg={pkg} route={effectiveRoute} onRevision={onRevision} /></details>
    <details className="rounded-xl border border-stone-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">补充待确认的真实素材需求</summary><MaterialEvidenceConfigurationPanel pkg={pkg} onPlanningChanged={async plan => {const ensure=guard.current.capture(identity,authToken);ensure();
      const actual = await socialProgramApi.getOperatingPackage(pkg.programId, pkg.packageId);
      ensure();if (current.current !== identity) throw Error('已切换周包，请回到原版本查看重新分析结果。');
      if (actual.programId !== pkg.programId || actual.packageId !== pkg.packageId || actual.version !== pkg.version || actual.agentPlanning?.planningId !== plan.planningId || actual.agentPlanning.version !== plan.version) throw Error('实际周包与重新分析结果不一致，请刷新核验。');
      if (!onPlanningChanged) throw Error('素材配置已保存并重新分析，请刷新本周工作台读取真实结果。');
      await onPlanningChanged(actual);
    }} /></details>
    <details className="rounded-xl border border-stone-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">配置逐视频发布承接</summary>
      <PublicationReceptionSetup key={`reception:${identity}`} pkg={pkg} onCreateRevision={async publicationTasks => {const ensure=guard.current.capture(identity,authToken);ensure();
        const next = await actions.saveReception(publicationTasks);
        ensure();onRevision(next);
      }} />
    </details>
    <details className="rounded-xl border border-stone-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">绑定本周真实客服运行</summary>
      {effectiveRoute ? <WeeklyCustomerRunBinding key={`customer:${identity}`} programId={pkg.programId} packageId={pkg.packageId} packageVersion={pkg.version} profile={effectiveRoute === 'cold_start' ? 'b2b_cold_start' : 'b2b_established'} /> : <p className="mt-3 text-sm text-amber-700">经营项目尚未确认用户画像，请先完成初始配置再绑定客服运行。</p>}
    </details>
    <details className="rounded-xl border border-stone-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">{initial?'首次容量排期（尚未执行）':'评估素材延迟与发布补救排期'}</summary>
      <WeeklyRecoveryPanel key={`recovery:${identity}:${initial}`} mode={initial?'initial':'recovery'} packageVersion={pkg.version} weekStart={pkg.weekStart} tasks={scoped} onReadProposal={initial?async proposalId=>{const ensure=guard.current.capture(identity,authToken);ensure();const proposal=await weeklyInitialScheduleApi.readProposal(initialScope(),proposalId);ensure();return proposal;}:undefined} onReadConfirmation={initial?async proposalId=>{const ensure=guard.current.capture(identity,authToken);ensure();const receipt=await weeklyInitialScheduleApi.readConfirmation(initialScope(),proposalId);ensure();return receipt;}:undefined} onPreviewTarget={async()=>{const ensure=guard.current.capture(identity,authToken);ensure();const graph=await previewGraph();ensure();if(current.current!==identity)throw Error('已切换周包，旧目标图不能用于当前排期。');return graph;}} onPropose={async input => {const ensure=guard.current.capture(identity,authToken);ensure();
        const graph=await previewGraph();ensure();if(current.current!==identity)throw Error('已切换周包，不能使用旧目标图。');const checked = buildBackwardScenario({ ...input, changedTaskIds: [] }, graph.tasks, pkg.version);assertTargetGraphCapacity(graph,checked);
        ensure();const proposal = initial?await weeklyInitialScheduleApi.propose(initialScope(),checked):await socialProgramApi.createScheduleRevisionProposal(pkg.programId, pkg.packageId, pkg.version, checked);
        ensure();if (current.current !== identity) throw Error('已切换周包，本次旧版本提案不再用于当前排期。');
        readTemplateCarryoverPlans(proposal);return proposal;
      }} onConfirm={async input => {const ensure=guard.current.capture(identity,authToken);ensure();
        const result = initial?await weeklyInitialScheduleApi.confirm(initialScope(),input):await socialProgramApi.confirmScheduleRevision(pkg.programId, pkg.packageId, input.proposalId, input.expectedVersion, input.inputEvidenceHash,input.confirmedTemplateCarryoverPlanHashes);
        ensure();if (current.current !== identity) throw Error('排期修订已保存，但当前视图已切换，请回到原周包查看新版本。');
        if (onScheduleConfirmed) onScheduleConfirmed(result);
        else onRevision(result.item);
        return result;
      }} onPlanBackward={async input => {const ensure=guard.current.capture(identity,authToken);ensure();
        const checked=buildBackwardScenario({...input,changedTaskIds:[]},scoped,pkg.version);
        const result=await socialProgramApi.planBackwardSchedule(pkg.programId,pkg.packageId,pkg.version,checked);
        ensure();if(current.current!==identity)throw Error('已切换周包，本次旧版本倒排建议不再用于当前排期。');
        return result;
      }} onAssess={async input => {const ensure=guard.current.capture(identity,authToken);ensure();
        const result = await actions.assessRecovery(input);
        ensure();if (current.current !== identity) throw Error('已切换周包，本次旧版本评估结果不再用于当前排期。');
        return result;
      }} />
    </details>
  </section>;
}
