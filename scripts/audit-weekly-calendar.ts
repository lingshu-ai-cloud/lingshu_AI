import assert from 'node:assert/strict';
import {projectExecutionCalendar} from '../src/components/socialProgram/weeklyExecutionCalendar';
import {STEP_LABEL} from '../src/components/socialProgram/weeklyExecutionLabels';
import {projectCalendarDeliverables,projectDailyCustomerServiceCards,orderDailyCalendarTasks,projectDailyMilestones} from '../src/components/smartBusiness/calendarDeliverables';
import type {WeeklyExecutionTask,WeeklyOperatingPackage,SocialProgram} from '../shared/contracts/socialProgram';

const root='http://127.0.0.1:5177/api/overseas';
const session=await fetch(`${root}/auth/local-preview-session`,{method:'POST',headers:{Origin:'http://127.0.0.1:5177','Content-Type':'application/json'}}).then(r=>r.json());
assert.ok(session.token,'Local preview login is unavailable');
async function request(path:string,init:RequestInit={}){
 const response=await fetch(`${root}${path}`,{...init,headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(20000)});
 const body=await response.json();return {status:response.status,body};
}
const programs=(await request('/social-programs/')).body.items as SocialProgram[];
assert.ok(programs.length);
for(const program of programs){
 const packages=(await request(`/social-programs/${program.programId}/operating-packages`)).body.items as WeeklyOperatingPackage[];
 const ref=program.activeWeeklyOperatingPackageRef;
 const pkg=packages.find(p=>p.packageId===ref?.id&&p.version===ref.version)??packages.sort((a,b)=>b.version-a.version)[0];
 if(!pkg)continue;
 const base=`/social-programs/${program.programId}/operating-packages/${pkg.packageId}`;
 const tasks=(await request(`${base}/execution-tasks?version=${pkg.version}`)).body.items as WeeklyExecutionTask[];
 const byId=new Map(tasks.map(task=>[task.taskId,task]));
 const problems:string[]=[];
 const steps:Record<string,number>={};
 for(const task of tasks){steps[task.schedule.stepKind]=(steps[task.schedule.stepKind]??0)+1;for(const id of task.dependsOnTaskIds){const upstream=byId.get(id);if(!upstream)problems.push(`${task.taskId}: missing upstream ${id}`);else if(upstream.tenantId!==task.tenantId)problems.push(`${task.taskId}: cross tenant dependency`);}}
 const visiting=new Set<string>(),visited=new Set<string>();
 function visit(id:string){if(visiting.has(id)){problems.push(`cycle ${id}`);return;}if(visited.has(id))return;visiting.add(id);byId.get(id)?.dependsOnTaskIds.forEach(visit);visiting.delete(id);visited.add(id);}
 tasks.forEach(task=>visit(task.taskId));
 const projected=projectExecutionCalendar(tasks,STEP_LABEL,Date.now(),{pkg});
 const cards=orderDailyCalendarTasks(projectDailyMilestones(projectDailyCustomerServiceCards(projectCalendarDeliverables(projected,true),pkg.weekStart)));
 assert.equal(new Set(cards.map(card=>card.id)).size,cards.length);
 const destinations=cards.flatMap(card=>card.dailyTaskGroup?.tasks??[card]);
 for(const task of tasks.filter(t=>!['customer_channel_readiness','customer_inquiry_handoff'].includes(t.schedule.stepKind))){const matches=destinations.filter(card=>card.id===task.taskId);if(matches.length!==1||matches[0]?.workspaceTarget?.executionTaskId!==task.taskId)problems.push(`${task.taskId}: missing or mismatched calendar destination`);}
 // Visual groups span parallel publication chains and are never executable nodes.
 // Audit original dependency order, not the quotient graph (which can have artificial cycles).
 const sourceOrder=orderDailyCalendarTasks(projectDailyCustomerServiceCards(projected,pkg.weekStart));
 for(const card of sourceOrder){for(const id of card.dependsOn??[]){const upstream=sourceOrder.find(candidate=>candidate.id===id);if(upstream&&(upstream.date>card.date||upstream.date===card.date&&sourceOrder.indexOf(upstream)>sourceOrder.indexOf(card)))problems.push(`${card.id}: original upstream displayed after consumer`);}}
 for(const task of tasks.filter(task=>task.schedule.stepKind==='customer_inquiry_handoff')){for(const id of task.dependsOnTaskIds){const upstream=byId.get(id);if(upstream?.schedule.stepKind!=='customer_channel_readiness'||upstream.inputSnapshot.customerChannel!==task.inputSnapshot.customerChannel||upstream.publicationTaskId!==task.publicationTaskId)problems.push(`${task.taskId}: wrong customer channel prerequisite`);}}
 let missing=0,verified=0;const failed:Array<{taskId:string;code:string}>=[];
 for(const task of tasks){const result=await request(`${base}/execution-tasks/${task.taskId}/workspace?version=${pkg.version}`);if(result.status===409&&(result.body.code??result.body.error)==='weekly_task_workspace_missing'){missing++;continue;}if(result.status!==200){failed.push({taskId:task.taskId,code:result.body.code??result.body.error});continue;}const workspace=result.body.item;try{assert.equal(workspace.executionTaskId,task.taskId);assert.equal(workspace.tenantId,task.tenantId);assert.equal(workspace.packageId,pkg.packageId);assert.equal(workspace.packageVersion,pkg.version);assert.equal(workspace.stepKind,task.schedule.stepKind);assert.deepEqual(workspace.upstreamTaskIds,task.dependsOnTaskIds);verified++;}catch{failed.push({taskId:task.taskId,code:'workspace_identity_or_dependencies_mismatch'});}}
 if(failed.length){const task=byId.get(failed[0]!.taskId)!;const workspace=(await request(`${base}/execution-tasks/${task.taskId}/workspace?version=${pkg.version}`)).body.item;console.log(JSON.stringify({firstMismatch:{step:task.schedule.stepKind,expectedDependencies:task.dependsOnTaskIds,workspaceDependencies:workspace?.upstreamTaskIds,workspaceTask:workspace?.executionTaskId}}));}
 console.log(JSON.stringify({programId:program.programId,packageId:pkg.packageId,version:pkg.version,taskCount:tasks.length,cardCount:cards.length,verifiedWorkspaces:verified,missingWorkspaces:missing,failedCount:failed.length,failed:failed.slice(0,2),problems,steps}));
 if(problems.length||failed.length||missing)process.exitCode=1;
}
