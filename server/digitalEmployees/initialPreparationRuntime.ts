import { advanceInitialPreparation, initialPreparationJobKey, persistInitialPreparationState, replaceInitialPreparationPlan, type InitialPreparation } from './initialPreparation.js';
import { createCrawlWorkerJob } from '../routes/crawlWorker.js';
import { hasWeeklyGoalFactRebuildPlanFence } from './goalFactRebuild.js';
import { acquireDurableOperationLease, assertDurableOperationLease, releaseDurableOperationLease } from '../runtime/durableLease.js';
import { randomUUID } from 'node:crypto';
import { compilePackage } from './weeklyPackage.js';
import { type WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { store } from '../storage/index.js';
import { enrichPackageWithContentSignals } from './contentPlanRecommendation.js';

import { goalInput } from './overviewProjection.js';
import { exactVideoAnalysis } from './taskEvidenceProjection.js';
import { evaluateViralAnalysisCoverage, hasParseableExactVideoAnalysis } from './viralAnalysisCoverage.js';

import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, type GoalRecord, type PlanRecord, type RunRecord, type StoredRecord } from './records.js';
import type { DigitalEmployeeApplicationPorts } from './applicationPorts.js';

export function createInitialPreparationRuntime(deps: Pick<DigitalEmployeeApplicationPorts, 'first' | 'tenantRecord' | 'weeklyGoalFactRebuildTargetCommitted' | 'resolveCurrentConfiguration' | 'configForTenant' | 'executionConfigForPlan' | 'generateWeeklyTaskPreviews' | 'approveGoalForReview'>) {
  function first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort = '-created_at'): Promise<T | null> {
    return deps.first<T>(collection, where, sort);
  }

  function tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
    return deps.tenantRecord<T>(collection, id, tenantId);
  }

  const weeklyGoalFactRebuildTargetCommitted: DigitalEmployeeApplicationPorts['weeklyGoalFactRebuildTargetCommitted'] = (...args) => deps.weeklyGoalFactRebuildTargetCommitted(...args);

  const resolveCurrentConfiguration: DigitalEmployeeApplicationPorts['resolveCurrentConfiguration'] = (...args) => deps.resolveCurrentConfiguration(...args);

  const configForTenant: DigitalEmployeeApplicationPorts['configForTenant'] = (...args) => deps.configForTenant(...args);

  const executionConfigForPlan: DigitalEmployeeApplicationPorts['executionConfigForPlan'] = (...args) => deps.executionConfigForPlan(...args);

  const generateWeeklyTaskPreviews: DigitalEmployeeApplicationPorts['generateWeeklyTaskPreviews'] = (...args) => deps.generateWeeklyTaskPreviews(...args);

  const approveGoalForReview: DigitalEmployeeApplicationPorts['approveGoalForReview'] = (...args) => deps.approveGoalForReview(...args);

  async function resumeInitialPreparationPlan(tenantId:string,goalId:string,allowBlocked=false){
    const lease=await acquireDurableOperationLease({dataStore:store,tenantId,scope:'initial_operating_preparation',subjectId:goalId,ownerId:`initial-${randomUUID()}`,leaseDurationMs:30*60_000});
    if(!lease)return;
    try{
      const plan=await first<PlanRecord>(COLLECTION.plans,{tenant_id:tenantId,goal_id:goalId});const goal=await tenantRecord<GoalRecord>(COLLECTION.goals,goalId,tenantId);if(!plan||!goal)return;
      if(!await weeklyGoalFactRebuildTargetCommitted(tenantId,goal))return;
      const body=jsonObject<Record<string,unknown>>(plan.plan,{});if(hasWeeklyGoalFactRebuildPlanFence(body))return;const state=body.initialPreparation as InitialPreparation|undefined;if(!state||state.status==='running'||state.status==='blocked'&&!allowBlocked)return;
      const packagePolicy=(body.businessPackage as WeeklyPackage | undefined)?.referenceSourcePolicy;
      if(packagePolicy==='existing_library_only'&&(state.referenceSourcePolicy!=='existing_library_only'||state.sources.length)){
        await persistInitialPreparationState({dataStore:store,collection:COLLECTION.plans,planId:plan.id,tenantId,state:{...state,status:'blocked',...(state.status==='preparing'?{failureCode:'preparation_outcome_unknown' as const}:{}),reason:'计划只允许使用现有爆款库，旧采集状态需要核对；系统不会创建新的采集任务。'}});return;
      }
      const existingRun=await first<RunRecord>(COLLECTION.runs,{tenant_id:tenantId,goal_id:goalId});if(existingRun&&existingRun.plan_id===plan.id){await persistInitialPreparationState({dataStore:store,collection:COLLECTION.plans,planId:plan.id,tenantId,state:{...state,status:'running',runId:existingRun.id,reason:''}});return;}
      if(plan.status!=='draft')return;
      const resolved=await resolveCurrentConfiguration(tenantId,await configForTenant(tenantId));if(!resolved)throw Error('初始化配置不存在');const config=executionConfigForPlan(plan,resolved.config);if(config.allowRealPublishing||config.allowRealCustomerMessages)throw Error('初始化制作准备不接受真实发布或客户发送授权');
      await advanceInitialPreparation(state,{
        save:async value=>{await assertDurableOperationLease({dataStore:store,lease,minimumRemainingMs:1000});await persistInitialPreparationState({dataStore:store,collection:COLLECTION.plans,planId:plan.id,tenantId,state:value});},
        enqueue:async source=>{const job=await createCrawlWorkerJob({tenantId,requestedBy:state.confirmedBy,platform:source.platform,mode:source.mode,keyword:source.mode==='keyword'?source.value:'',accountUrl:source.mode==='account'?source.value:'',accountName:config.companyName,limit:30,idempotencyKey:initialPreparationJobKey(tenantId,state,source)});if(!job)throw Error('真实采集任务创建失败');return job.id;},
        observe:async id=>{const job=await store.getById<StoredRecord>('crawl_jobs',id);if(!job||job.tenantId!==tenantId)throw Error('原采集任务不存在');const result=jsonObject<{candidateIds?:string[]}>(job.resultJson,{});return {status:String(job.status),candidateIds:result.candidateIds||[],error:String(job.error||'')};},
        libraryCandidates:async()=>{const candidates:StoredRecord[]=[];for(let page=1;;page++){const batch=await store.list<StoredRecord>('trend_videos',{where:{tenantId},sort:'-updatedAt',page,perPage:500});candidates.push(...batch.items.filter(item=>item.tenantId===tenantId&&hasParseableExactVideoAnalysis(item)));if(page>=batch.totalPages)break;if(!batch.items.length)throw Error('爆款库分页读取不完整');}return candidates.map(item=>item.id);},
        analyzed:async ids=>{const rows=await Promise.all(ids.map(id=>store.getById<StoredRecord>('trend_videos',id)));if(rows.some(row=>!row||row.tenantId!==tenantId))throw Error('原采集候选已失效');if(state.referenceSourcePolicy==='existing_library_only'){const pack=body.businessPackage as WeeklyPackage;const plans=pack.tasks.find(task=>task.templateId==='production')?.videoPlans||[];const coverage=evaluateViralAnalysisCoverage(plans,rows.filter((row):row is StoredRecord=>!!row),{explicitReferenceIds:[]});if(coverage.requiredCount===0||coverage.ready)return true;throw Error(`现有爆款库可用参考不足：${coverage.completedCount}/${coverage.requiredCount}；未发起新的采集。`);}const exact=rows.filter(row=>row&&exactVideoAnalysis(row));if(exact.length>=Math.max(1,Number(goal.target)||1))return true;if(rows.every(row=>['analyzed','failed'].includes(String(row!.status))))throw Error('真实全片分析合格参考不足，请调整范围或修复分析后继续');return false;},
        prepare:async ids=>{const latest=await tenantRecord<PlanRecord>(COLLECTION.plans,plan.id,tenantId);if(!latest)throw Error('原计划不存在');const currentBody=jsonObject<Record<string,unknown>>(latest.plan,{});const pack=currentBody.businessPackage as WeeklyPackage;if(pack.revision!==state.revision)throw Error('计划版本已修改，请重新确认');const videos=await Promise.all(ids.map(id=>store.getById<StoredRecord>('trend_videos',id)));const enriched=enrichPackageWithContentSignals({pack,goal:goalInput(goal),config,videos:videos.filter((v):v is StoredRecord=>!!v),benchmarks:[]});const detailed=await generateWeeklyTaskPreviews({tenantId,goal,plan:latest,pack:enriched,config,planBody:currentBody});const compiled=compilePackage(detailed,goalInput(goal),config);await replaceInitialPreparationPlan({dataStore:store,collection:COLLECTION.plans,expected:latest,tenantId,nextPlan:{...currentBody,...compiled},conflictMessage:'计划版本已修改，请重新确认'});return {ready:detailed.detailGeneration?.status==='ready',reason:detailed.detailGeneration?.blockers.join('；'),revision:detailed.revision};},
        activate:async revision=>{const result=await approveGoalForReview(tenantId,state.confirmedBy,goalId,revision,[]);if(result.status!==200)throw Error((result.body as {message?:string;error?:string}).message||(result.body as {error?:string}).error||'制作启动失败');const run=await first<RunRecord>(COLLECTION.runs,{tenant_id:tenantId,goal_id:goalId});if(!run)throw Error('实际制作运行未创建');return run.id;},
      });
    }finally{await releaseDurableOperationLease({dataStore:store,lease});}
  }

  async function resumeConfirmedInitialPlans(){
    for(let page=1;;page++){const rows=await store.list<PlanRecord>(COLLECTION.plans,{page,perPage:200});
      for(const row of rows.items){const state=jsonObject<{initialPreparation?:InitialPreparation}>(row.plan,{}).initialPreparation;if(state&&['collecting','analyzing','preparing'].includes(state.status))await resumeInitialPreparationPlan(row.tenant_id,row.goal_id).catch(error=>console.warn('[initial-preparation]',String(error)));}
      if(page>=rows.totalPages||rows.items.length<200)break;}
  }

  let initialPreparationTimer:ReturnType<typeof setInterval>|undefined;

  function initInitialPreparationWorker():boolean{if(initialPreparationTimer)return false;initialPreparationTimer=setInterval(()=>{void resumeConfirmedInitialPlans().catch(error=>console.warn('[initial-preparation]',String(error)));},30_000);initialPreparationTimer.unref?.();return true;}

  function stopInitialPreparationWorker(){if(!initialPreparationTimer)return;clearInterval(initialPreparationTimer);initialPreparationTimer=undefined;}

  return { resumeInitialPreparationPlan, resumeConfirmedInitialPlans, initInitialPreparationWorker, stopInitialPreparationWorker };
}
