import test from 'node:test';import assert from 'node:assert/strict';
import {weeklyBlockerAction,classifyWeeklyBlocker} from './weeklyTaskAudit.js';
import {auditWeeklyTasks} from './weeklyTaskAudit.js';
import {prepareWeeklyEnterpriseFactFixture} from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import {adoptWeeklyAutomationTemplate} from './weeklyAutomationTemplate.js';
test('post-analysis media and semantic-budget gaps remain visible system work, not a request for an unknown customer file or a paid bypass',()=>{
 for(const code of ['weekly_postanalysis_canonical_media_intervention_required','weekly_postanalysis_canonical_evidence_intervention_required','weekly_postanalysis_exact_analysis_authorization_required','weekly_postanalysis_exact_analysis_original_receipt_pending','candidate_context_semantic_budget_authorization_required','weekly_candidate_semantic_budget_binding_unverified']){
  const action=weeklyBlockerAction(code);
  assert.equal(classifyWeeklyBlocker(code),'technical',code);
  assert.equal(action.userRequired,false,code);
  assert.equal(action.action,'technical_recovery',code);
  assert.doesNotMatch(action.label,/请上传|立即重新采集|自动通过/);
 }
 assert.match(weeklyBlockerAction('candidate_context_semantic_budget_authorization_required').label,/尚未接入/);
});
test('same-product footage asks for user intervention only after the concrete task reports that blocker',()=>{
 const missing=weeklyBlockerAction('weekly_product_footage_required');
 assert.equal(classifyWeeklyBlocker('weekly_product_footage_required'),'user_input');
 assert.equal(missing.action,'product_footage');assert.equal(missing.userRequired,true);
 assert.match(missing.label,/当前样片/);assert.match(missing.label,/上传本身不等于审核通过/);
 const drift=weeklyBlockerAction('product_footage_bytes_changed');
 assert.equal(classifyWeeklyBlocker('product_footage_bytes_changed'),'technical');
 assert.equal(drift.action,'technical_recovery');assert.equal(drift.userRequired,false);
 assert.match(drift.label,/不要求提前上传/);
});
test('the original blocked content job projects its concrete footage intervention into the weekly task after restart',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t),publicationTaskId='pub';
 const task={...f.task,taskId:'weekly-video',publicationTaskId,status:'blocked',ownBlockingReasons:[],
  schedule:{...f.task.schedule,stepKind:'video_generation'}} as any;
 await f.store.create('starter_social_content_tasks',{id:'content-row',tenant_id:task.tenantId,task_id:'content-task',
  create_idempotency_key:`weekly-production:${task.packageId}:${task.packageVersion}:${publicationTaskId}`,
  run_id:'content-run',status:'paused'});
 await f.store.create('content_execution_jobs',{id:'content-job',tenant_id:task.tenantId,task_id:'content-task',run_id:'content-run',
  task_type:'social_content_weekly',status:'blocked',last_error:'production_input_required:weekly_product_footage_required'});
 const audit=await auditWeeklyTasks(f.store,[task]);
 const action=audit.items[0]!.requiredActions.find(item=>item.action==='product_footage');
 assert.equal(action?.code,'weekly_product_footage_required');assert.equal(action?.taskId,task.taskId);assert.equal(action?.userRequired,true);
 await f.store.update('content_execution_jobs','content-job',{status:'queued'});
 const cleared=await auditWeeklyTasks(f.store,[task]);
 assert.ok(!cleared.items[0]!.requiredActions.some(item=>item.action==='product_footage'));
});
test('the original blocked content job projects actual presenter and voice intervention without a preflight card',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t),publicationTaskId='pub';
 const task={...f.task,taskId:'weekly-presenter',publicationTaskId,status:'blocked',ownBlockingReasons:[],
  schedule:{...f.task.schedule,stepKind:'video_generation'}} as any;
 await f.store.create('starter_social_content_tasks',{id:'presenter-content-row',tenant_id:task.tenantId,task_id:'presenter-content',
  create_idempotency_key:`weekly-production:${task.packageId}:${task.packageVersion}:${publicationTaskId}`,
  run_id:'presenter-run',status:'paused'});
 await f.store.create('content_execution_jobs',{id:'presenter-content-job',tenant_id:task.tenantId,task_id:'presenter-content',run_id:'presenter-run',
  task_type:'social_content_weekly',status:'blocked',last_error:'user_input_required:weekly_default_voice_authorization_missing:enterprise-person'});
 const audit=await auditWeeklyTasks(f.store,[task]);
 const action=audit.items[0]!.requiredActions.find(item=>item.action==='presenter_voice');
 assert.equal(action?.code,'weekly_default_voice_authorization_missing:enterprise-person');assert.equal(action?.userRequired,true);
 assert.match(action?.label??'',/当前样片/);assert.match(action?.label??'',/不静默换人或换声/);
 await f.store.update('content_execution_jobs','presenter-content-job',{last_error:'user_input_required:weekly_default_voice_binding_mismatch'});
 const mismatch=await auditWeeklyTasks(f.store,[task]);
 const technical=mismatch.items[0]!.requiredActions.find(item=>item.code==='weekly_default_voice_binding_mismatch');
 assert.equal(technical?.action,'technical_recovery');assert.equal(technical?.userRequired,false);
});
test('missing product selection differs from technical contextual assessment and neither asks for a forced pass',()=>{
 const missing=weeklyBlockerAction('weekly_candidate_context_required');
 assert.equal(missing.action,'candidate_analysis');assert.equal(missing.userRequired,true);assert.equal(classifyWeeklyBlocker('weekly_candidate_context_required'),'user_input');
 assert.match(missing.label,/选择已有商品/);assert.match(missing.label,/不重新分析/);
 const review=weeklyBlockerAction('weekly_candidate_context_review_required');
 assert.equal(review.userRequired,false);assert.equal(classifyWeeklyBlocker('weekly_candidate_context_review_required'),'technical');assert.match(review.label,/缺值不是低分/);assert.match(review.label,/不要求用户直接批准通过/);
});
test('unavailable analysis model is a configuration blocker, not a new crawl or business input request',()=>{
 const action=weeklyBlockerAction('model_unavailable');assert.equal(action.action,'candidate_analysis');assert.equal(action.userRequired,false);assert.equal(classifyWeeklyBlocker('model_unavailable'),'technical');assert.match(action.label,/模型/);assert.match(action.label,/不重采集/);assert.match(action.label,/历史费用保留/);
});
test('default planning and dispatch are technical work, not repeated user confirmation; real external permissions remain explicit',()=>{
 for(const code of ['business_goal_unavailable','capacity_plan_unavailable','automation_policy_unavailable','metric_targets_required','weekly_initial_capacity_schedule_required','weekly_preproduction_authority_required']){
  assert.equal(classifyWeeklyBlocker(code),'technical',code);assert.equal(weeklyBlockerAction(code).userRequired,false,code);
 }
 assert.equal(weeklyBlockerAction('weekly_existing_facts_hash_changed').action,'enterprise_facts');
 assert.equal(weeklyBlockerAction('tenant_real_customer_messages_not_authorized').userRequired,true);
 assert.equal(weeklyBlockerAction('conversion_route_required').userRequired,true);
});
test('real channel actions name their own platform and never require real permission for Mock transport',()=>{
 const whats=weeklyBlockerAction('tenant_real_customer_messages_not_authorized',{inputSnapshot:{customerChannel:'whatsapp'}} as any);
 const messenger=weeklyBlockerAction('tenant_real_customer_messages_not_authorized',{inputSnapshot:{customerChannel:'messenger'}} as any);
 assert.match(whats.label,/WhatsApp 真实分支/);assert.match(messenger.label,/Messenger 真实分支/);
 for(const code of ['whatsapp_provider_not_ready','customer_agent_not_enabled','followup_background_worker_disabled','weekly_customer_channel_run_missing']){
  assert.equal(weeklyBlockerAction(code).userRequired,false,code);assert.equal(classifyWeeklyBlocker(code),'technical',code);
 }
});
test('paid collection service exhaustion is an exact technical recovery, not missing business facts or mock delivery',()=>{
 const code='provider_budget_exhausted',action=weeklyBlockerAction(code);
 assert.equal(classifyWeeklyBlocker(code),'technical');assert.equal(action.userRequired,false);assert.equal(action.action,'collection_service');
 assert.match(action.label,/采集服务额度不足/);assert.match(action.label,/未知费用占用保留/);assert.match(action.label,/不生成模拟采集结果/);
});
test('daily quota and qualified-mother shortage remain distinct technical projections without user reapproval',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t);
 for(const code of ['daily_collection_limit_reached','weekly_qualified_quota_exhausted','weekly_qualified_admission_unverified']){
  const action=weeklyBlockerAction(code);
  assert.equal(classifyWeeklyBlocker(code),'technical',code);
  assert.equal(action.userRequired,false,code);
  assert.notEqual(action.action,'production',code);
  assert.doesNotMatch(action.label,/请用户重填|重新批准模板/);
 }
 const task={...f.task,taskId:'audit-discovery-capacity',status:'blocked',schedule:{...f.task.schedule,stepKind:'benchmark_collection'},dependsOnTaskIds:[],ownBlockingReasons:['daily_collection_limit_reached'],lastError:null} as any;
 const before=structuredClone(task),audit=await auditWeeklyTasks(f.store,[task]);
 const action=audit.items[0]!.requiredActions.find(a=>a.code==='daily_collection_limit_reached');
 assert.equal(action?.action,'collection_service');assert.equal(action?.userRequired,false);
 assert.deepEqual(task,before);
});
test('missing downloader is a technical component gap, not missing enterprise facts or permanently unavailable media',()=>{
 const action=weeklyBlockerAction('downloader_missing');
 assert.equal(classifyWeeklyBlocker('downloader_missing'),'technical');assert.equal(action.userRequired,false);assert.equal(action.action,'candidate_analysis');
 assert.match(action.label,/yt-dlp/);assert.match(action.label,/不是企业资料缺失或视频永久不可用/);assert.match(action.label,/未知请求不得重复提交/);
});
test('scoped candidate recovery directs existing analysis, never a new collection or business facts',()=>{
 for(const code of ['weekly_candidate_analysis_pending','weekly_candidate_analysis_original_receipt_pending','weekly_candidate_analysis_review_required','weekly_candidate_quality_insufficient','source_media_unavailable','downloader_missing','weekly_candidate_analysis_unavailable','weekly_candidate_source_scope_changed','weekly_candidate_owned_media_changed','weekly_candidate_reassessment_source_changed']){
  const action=weeklyBlockerAction(code);assert.equal(action.action,'candidate_analysis',code);assert.match(action.label,/原|已有/);assert.doesNotMatch(action.label,/重新填写企业|提高采集额度以解决/);
 }
 const pending=weeklyBlockerAction('weekly_candidate_analysis_original_receipt_pending');assert.equal(pending.userRequired,false);assert.match(pending.label,/不得重新发送或再次计费/);assert.match(pending.label,/费用未知占用保留/);
});
test('current verified facts remove obsolete hash advice from read model without modifying durable history',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t);
 const task={...f.task,taskId:'audit-script',status:'blocked',schedule:{...f.task.schedule,stepKind:'script'},dependsOnTaskIds:[],ownBlockingReasons:['weekly_existing_facts_hash_changed'],lastError:{code:'weekly_existing_facts_hash_changed',message:'original historical failure',occurredAt:'2026-10-01T00:00:00Z'}} as any;
 const before=structuredClone(task);
 const audit=await auditWeeklyTasks(f.store,[task]);
 assert.deepEqual(audit.items[0]!.ownReasons,[]);
 assert.deepEqual(audit.items[0]!.requiredActions,[]);
 assert.deepEqual(task,before);
});
test('accepted automatic publication exposes missing selection as user action without inventing a catalogue default',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t);
 const scope={tenantId:f.task.tenantId,programId:f.task.programId,packageId:f.task.packageId,packageVersion:1};
 const row=(await f.store.list<any>('social_weekly_operating_packages')).items[0]!;
 const publication={...row.payload.socialContentPackage.publicationTasks[0],motherContentId:'mother-a',status:'planned'};
 await f.store.update('social_weekly_operating_packages',row.id,{payload:{...row.payload,socialContentPackage:{...row.payload.socialContentPackage,publicationTasks:[publication]}}});
 await adoptWeeklyAutomationTemplate(f.store,scope,'owner');
 const task={...f.task,inputSnapshot:{publicationTask:publication},status:'blocked',ownBlockingReasons:[]} as any;
 const before=structuredClone(task),audit=await auditWeeklyTasks(f.store,[task]);
 assert.ok(audit.items[0]!.requiredActions.some(action=>action.code==='weekly_production_product_selection_required'&&action.action==='publication_product'&&action.userRequired));
 assert.deepEqual(task,before);
});
test('publication selection read failure is technical recovery, not another user signature',()=>{
 const action=weeklyBlockerAction('weekly_production_product_selection_read_failed');
 assert.equal(action.action,'technical_recovery');assert.equal(action.userRequired,false);
 assert.equal(classifyWeeklyBlocker('weekly_production_product_selection_read_failed'),'technical');
 const pending=weeklyBlockerAction('weekly_production_product_selection_pending_operation');
 assert.equal(pending.action,'publication_product');assert.equal(pending.userRequired,false);
 assert.equal(classifyWeeklyBlocker('weekly_production_product_selection_pending_operation'),'technical');
 const conflict=weeklyBlockerAction('weekly_production_product_selection_group_conflict');
 assert.equal(conflict.userRequired,false);assert.equal(classifyWeeklyBlocker('weekly_production_product_selection_group_conflict'),'technical');
});
