import assert from 'node:assert/strict';
import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import {createWeeklyExecutionTaskService} from '../socialPrograms/executionTasks.js';
import {createSocialWeeklyExecutionWorker} from './socialWeeklyExecutionWorker.js';
import {createSocialWeeklyCustomerChannelAdapter} from './socialWeeklyCustomerChannelAdapter.js';
import {createSocialWeeklyPublicationAdapter} from './socialWeeklyPublicationAdapter.js';
import {createWeeklyContentTemplateService} from '../socialPrograms/weeklyContentTemplates.js';
import {readStarterPublicationPackage} from '../publishing/starterPublicationPackage.js';
import {createWeeklyContentTemplateExecutionAdapter} from './socialWeeklyContentTemplateAdapter.js';

/** Finish the actual persisted post-publication graph using controlled metric
 * port records. No task status or completion receipt is manufactured here. */
export async function finishFiveMotherReview(input:{store:DataStore;pkg:WeeklyOperatingPackage;tenantId:string;actorUserId:string;now:Date}){
 const {store,pkg,tenantId,actorUserId,now}=input;
 const tasks=createWeeklyExecutionTaskService(store),worker=createSocialWeeklyExecutionWorker(store);
 const assignments=await store.list<Record_>('social_publication_assignments',{where:{tenant_id:tenantId,operating_package_id:pkg.packageId,operating_package_version:pkg.version},perPage:100});
 assert.equal(assignments.totalItems,5,'five actual publication assignments are required before review');
 const capturedAt=`${pkg.weekEnd}T23:00:00Z`;
 for(const [index,publication] of pkg.socialContentPackage.publicationTasks.entries()){
  const matches=assignments.items.filter(a=>a.publication_task_id===publication.publicationTaskId);assert.equal(matches.length,1);
  const assignment=matches[0]!;
  const attempts=await store.list<Record_>('social_publication_attempts',{where:{tenant_id:tenantId,assignment_id:String(assignment.assignment_id)},perPage:2});
  assert.equal(attempts.totalItems,1);const attempt=attempts.items[0]!;assert.equal(attempt.status,'published');
  const manifest=await readStarterPublicationPackage(tenantId,String(assignment.package_id),store);assert.ok(manifest);
  for(const contentId of new Set([String(attempt.platform_post_id),String(manifest.contentId)]))await store.create('social_metric_snapshots',{tenant_id:tenantId,account_id:publication.accountId,platform:publication.platform,content_id:contentId,captured_at:capturedAt,source:'controlled_provider_contract',value_kind:'cumulative',metrics:{views:1000+index*100,likes:20+index,shares:5+index,comments:5+index}});
 }
 const publicationAdapter=createSocialWeeklyPublicationAdapter(store,{now:()=>now}),channelAdapter=createSocialWeeklyCustomerChannelAdapter(store,{now:()=>now});
 const templateAdapter=createWeeklyContentTemplateExecutionAdapter(store),templates=createWeeklyContentTemplateService(store,{now:()=>now.toISOString()});
 const tailSteps=['customer_inquiry_handoff','performance_monitoring','weekly_review','template_extraction','template_performance_validation'];
 const completions:Array<{taskId:string;step:string;refIds:string[]}>=[];
 for(let iteration=0;iteration<40;iteration++){
  const graph=await tasks.list(tenantId,pkg.programId,pkg.packageId,pkg.version);
  const remaining=graph.filter(t=>tailSteps.includes(t.schedule.stepKind)&&t.status!=='succeeded');
  if(!remaining.length)break;
  for(const task of remaining.filter(t=>t.schedule.stepKind==='template_extraction'&&t.dependsOnTaskIds.every(id=>graph.find(t=>t.taskId===id)?.status==='succeeded'))){
   const scope={tenantId,programId:pkg.programId};
   if(await templates.readExecutionSelection(scope,task.taskId))continue;
   const review=graph.find(t=>t.taskId===task.inputSnapshot.reviewTaskId);assert.ok(review);
   const reviewRef=review.resultRefs.find(r=>r.type==='weekly_review_snapshot');assert.ok(reviewRef);
   const publication=pkg.socialContentPackage.publicationTasks.find(p=>p.publicationTaskId===task.publicationTaskId);assert.ok(publication);
   const candidate=await templates.create(scope,{actorUserId,sourceTaskId:String(task.inputSnapshot.sourceTaskId),reviewRef,action:'new',title:`受控整周模板 ${publication.motherContentId}`,reason:'明确基于本周真实 worker 产物和受控指标保留试用结构',applicability:{platform:publication.platform,audience:'企业采购',productScope:'同系列企业产品',replaceFacts:['产品事实与品牌须重新核验'],prohibited:['不沿用外部作者身份']}});
   const templateRef={type:'weekly_content_template',id:candidate.templateId,version:candidate.version};
   await templates.selectExecutionCandidate({...scope,actorUserId},{taskId:task.taskId,templateRef,candidateHash:candidate.recordHash});
   await templates.confirm(scope,{actorUserId,templateRef,candidateHash:candidate.recordHash,usage:'trial',reason:'受控审核明确试用，未自动批准下周生产'});
  }
  const claim=await worker.claimNext({tenantId,workerId:'five-mother-post-publication',kinds:['engagement','review','directing'],now});
  assert.ok(claim,JSON.stringify(remaining.map(t=>({step:t.schedule.stepKind,status:t.status,blockers:t.ownBlockingReasons,depends:t.dependsOnTaskIds}))));
  assert.ok(tailSteps.includes(claim.task.schedule.stepKind),'production must have completed before finishing the review graph');
  const result=await (claim.task.schedule.stepKind==='customer_inquiry_handoff'?channelAdapter:claim.task.schedule.stepKind.startsWith('template_')?templateAdapter:publicationAdapter).execute(claim.task);
  assert.equal(result.status,'succeeded',JSON.stringify(result));if(result.status!=='succeeded')throw Error('post-publication evidence unavailable');
  await worker.complete(claim,result.resultRefs,now);
  completions.push({taskId:claim.task.taskId,step:claim.task.schedule.stepKind,refIds:result.resultRefs.map(r=>r.id)});
 }
 const graph=await tasks.list(tenantId,pkg.programId,pkg.packageId,pkg.version);
 assert.ok(graph.every(t=>t.status==='succeeded'),JSON.stringify(graph.filter(t=>t.status!=='succeeded').map(t=>({step:t.schedule.stepKind,status:t.status,blockers:t.ownBlockingReasons}))));
 assert.equal(completions.filter(t=>t.step==='customer_inquiry_handoff').length,15);
 assert.equal(completions.filter(t=>t.step==='template_extraction').length,5);
 assert.equal(completions.filter(t=>t.step==='template_performance_validation').length,5);
 return{completions,graph};
}
