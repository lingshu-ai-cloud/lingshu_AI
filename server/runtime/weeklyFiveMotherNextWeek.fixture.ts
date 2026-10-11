import assert from 'node:assert/strict';
import type {WeeklyMaterialPorts} from '../socialPrograms/weeklyMaterialRequests.js';
import type {DataStore} from '../storage/datastore.js';
import type {WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import {createWeeklyPlanningAuthority} from '../socialPrograms/planningAuthority.js';
import {applyBusinessDispatchToExecutionTasks,listWeeklyExecutionTasks} from '../socialPrograms/executionTasks.js';
import {createWeeklyInitialScheduleService} from '../socialPrograms/weeklyInitialSchedule.js';
import {createWeeklyOperatingPackageService} from '../socialPrograms/weeklyOperatingPackages.js';
export async function dispatchFiveMotherWeek(store:DataStore,pkg:WeeklyOperatingPackage,clock:string){
 const authority=createWeeklyPlanningAuthority(store),scope={tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version};
 const existing=await authority.initialize('t',pkg);if(existing.status==='dispatched')return listWeeklyExecutionTasks(store,'t','p',pkg.packageId,pkg.version);
 const initial=existing,analyzed=await authority.runDirectorAnalysis({...scope,expectedPlanningVersion:initial.version,actor:'director_agent'}),detailed=await authority.mergeDetailedSchedule({tenantId:'t',programId:'p',package:pkg,expectedPlanningVersion:analyzed.version,actor:'business_agent'}),confirmed=await authority.confirm({...scope,expectedPlanningVersion:detailed.version,userId:'owner'}),dispatched=await authority.dispatch({...scope,expectedPlanningVersion:confirmed.version,actor:'business_agent'});
 assert.ok(dispatched.dispatch);await applyBusinessDispatchToExecutionTasks(store,'t','p',pkg.packageId,pkg.version,dispatched.dispatch,clock);return listWeeklyExecutionTasks(store,'t','p',pkg.packageId,pkg.version);
}
export async function scheduleFiveMotherNextWeek(store:DataStore,pkg:WeeklyOperatingPackage,clock:string,materialPorts?:WeeklyMaterialPorts){
 const tasks=await dispatchFiveMotherWeek(store,pkg,clock),schedule=createWeeklyInitialScheduleService(store,{now:()=>clock,materialPorts}),scope={tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,actorUserId:'owner'};
 const proposal=await schedule.propose(scope,{constraints:Object.fromEntries(tasks.map(task=>[task.taskId,{resourceKey:task.schedule.responsibleActor,remainingMinutes:task.schedule.estimatedDurationMinutes,remainingCostCny:1,bufferMinutes:0,availableAt:clock}])),resources:Object.fromEntries([...new Set(tasks.map(task=>task.schedule.responsibleActor))].map(actor=>[actor,{concurrency:1,workingWindows:[{startAt:clock,finishAt:'2026-11-10T20:00:00Z'}]}])),remainingBudgetCny:1000,operationalDeadlines:Object.fromEntries(tasks.filter(task=>['performance_monitoring','weekly_review','template_extraction','template_performance_validation'].includes(task.schedule.stepKind)).map(task=>[task.taskId,'2026-11-10T18:00:00Z']))});
 assert.equal(proposal.plan.publicationGap,0);const confirmation=await schedule.confirm(scope,{proposalId:proposal.proposalId,expectedVersion:pkg.version,inputEvidenceHash:proposal.inputEvidenceHash});assert.deepEqual(confirmation.materialConsumerRepairs,[]);const next=await createWeeklyOperatingPackageService(store).get('t','p',pkg.packageId);const fresh=await dispatchFiveMotherWeek(store,next,clock);return {pkg:next,tasks:fresh};
}
