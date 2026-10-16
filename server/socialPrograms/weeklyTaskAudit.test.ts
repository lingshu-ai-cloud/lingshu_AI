import test from 'node:test';import assert from 'node:assert/strict';
import {weeklyBlockerAction,classifyWeeklyBlocker} from './weeklyTaskAudit.js';
import {auditWeeklyTasks} from './weeklyTaskAudit.js';
import {prepareWeeklyEnterpriseFactFixture} from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
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
