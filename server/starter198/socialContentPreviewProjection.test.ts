import test from 'node:test';
import assert from 'node:assert/strict';
import type { StarterRecord, Starter198Repository } from './repository.js';
import type { SocialContentTaskSummary } from '../../shared/contracts/socialContentWorkflow.js';
import { socialContentVideoPreview, hydrateSocialContentPreviews } from './socialContentPreviewProjection.js';
const record=(patch:Partial<StarterRecord>={}):StarterRecord=>({id:'row',tenant_id:'tenant',task_id:'task',artifact_id:'artifact',artifact_kind:'short_video',
 status:'review_required',version:'1',updated_at:'2026-10-25T00:00:00Z',resource_ref:'socialfile:socialfile_'+ 'a'.repeat(24),
 content:{mediaStorage:{video:{fileRef:'socialfile:socialfile_'+ 'a'.repeat(24),url:'/private/local-path',localPath:'/private/server.mp4'}},delivery:{status:'needs_revision'},render:{qualityPassed:false}},...patch});

test('archived failed-quality video remains previewable without publication approval or local-path leakage',()=>{
 const result=socialContentVideoPreview(record(),'tenant');assert.ok(result);
 assert.equal(result.requiresRevision,true);assert.equal(result.approved,false);assert.equal(result.status,'需修改 · 可预览');
 assert.equal(result.mediaUrl,'/api/overseas/starter-198/social-content/tasks/task/artifacts/artifact/media');
 assert.equal(JSON.stringify(result).includes('/private/'),false);
});
test('test placeholders are previewable and never inherit an approved release state',()=>{
 const result=socialContentVideoPreview(record({status:'approved',content:{testOnly:true,publishable:false,delivery:{status:'publish_candidate'}}}),'tenant');
 assert.equal(result?.testOnly,true);assert.equal(result?.approved,false);assert.equal(result?.status,'测试占位 · 不可发布');
});
test('human-approved video no longer shows a pending lip review while immutable evidence remains',()=>{
 const content={delivery:{status:'publish_candidate'},presenterSpeechReview:{status:'pending_human_review',automatedLipSyncPassed:false}};
 const pending=socialContentVideoPreview(record({content}),'tenant');
 assert.match(pending!.reason,/口型效果待人工验收/);
 const approved=socialContentVideoPreview(record({status:'approved',content}),'tenant');
 assert.equal(approved?.approved,true);assert.equal(approved?.status,'已验收');
 assert.doesNotMatch(approved!.reason,/口型效果待人工验收/);
 const fixture=socialContentVideoPreview(record({status:'approved',content:{...content,testOnly:true,publishable:false}}),'tenant');
 assert.equal(fixture?.approved,false);assert.equal(fixture?.status,'测试占位 · 不可发布');
});
test('foreign tenant, missing archive, superseded version and non-video do not become previews',()=>{
 for(const patch of [{tenant_id:'other'},{resource_ref:'https://example.test/video.mp4'},{status:'superseded'},{artifact_kind:'script'}])assert.equal(socialContentVideoPreview(record(patch),'tenant'),null);
 assert.equal(socialContentVideoPreview(record({content:{mediaStorage:{video:{fileRef:'socialfile:other'}}}}),'tenant'),null);
});
test('caption uncertainty and measured mismatch remain distinct from human lip acceptance',()=>{
 const preview=(captionMaskAudit:Record<string,unknown>)=>socialContentVideoPreview(record({content:{
   technicalQualityReport:{mediaHardProbe:{captionMaskAudit}},
   presenterSpeechReview:{status:'pending_human_review'},
 }}),'tenant')!;
 for(const audit of [{status:'unknown'}, {status:'observed_mask_delta'},
   {status:'observed_mask_delta',simplePixelProof:{status:'unknown'}}]){
  const result=preview(audit);
  assert.match(result.reason,/字幕技术检查尚未完成/);
  assert.match(result.reason,/口型效果待人工验收/);
  assert.equal(result.approved,false);
 }
 const mismatch=preview({status:'unknown',plainCueBinding:{status:'mismatch'},reason:'private diagnostic path'});
 assert.match(mismatch.reason,/字幕与确认的文案不一致/);
 assert.doesNotMatch(mismatch.reason,/private diagnostic path|字幕技术检查尚未完成/);
 const matched=preview({status:'observed_mask_delta',simplePixelProof:{status:'matched'}});
 assert.doesNotMatch(matched.reason,/字幕技术检查尚未完成/);
 assert.equal(matched.approved,false,'one passed check must never approve the artifact');
});
test('one scoped artifact scan binds previews only to the listed tenant tasks, including review outputs',async()=>{
 let calls=0;const repository={list:async(_collection:string,tenantId:string)=>{calls++;assert.equal(tenantId,'tenant');return {items:[record(),record({artifact_id:'foreign',tenant_id:'other'}),record({task_id:'not-on-page'})],totalPages:1};}} as unknown as Starter198Repository;
 const items=[{taskId:'task'}] as SocialContentTaskSummary[];
 const result=await hydrateSocialContentPreviews({repository,tenantId:'tenant',items});
 assert.equal(calls,1);assert.equal(result[0]?.renderedPreviews?.length,1);assert.equal(items[0]?.renderedPreviews,undefined);
});

test('source visible text is a review hint without new quality or approval gates',()=>{
 const content={delivery:{status:'publish_candidate'},technicalQualityReport:{sourceTextReview:[{
  sceneId:'scene',source:'analysis_on_screen_text',spatialStatus:'unmeasured',status:'review_required',text:'private source text',
 }]}};
 const result=socialContentVideoPreview(record({status:'approved',content}),'tenant')!;
 assert.match(result.reason,/原画面文字/);assert.match(result.reason,/文字位置尚未测量/);
 assert.doesNotMatch(result.reason,/private source text/);
 assert.equal(result.approved,true);assert.equal(result.requiresRevision,false);
});
