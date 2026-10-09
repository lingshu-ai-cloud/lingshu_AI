import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyDirectorPlanningAnalysis} from '../../shared/contracts/socialProgram.js';
import type {SocialContentTaskDetail} from '../../shared/contracts/socialContentWorkflow.js';
import {socialObject,socialJson,socialRequestHash,SocialContentWorkflowError} from '../starter198/socialContentValidation.js';
import {buildSocialTaskReferencePackage} from '../starter198/socialContentScriptSources.js';
import type {SocialTaskReferenceResolver} from '../starter198/socialContentTaskSupport.js';
const obj=(value:unknown)=>socialObject(socialJson(value));
/** Selected immutable handoff identifies the exact catalog source. No recommendation/network fallback. */
export async function readWeeklyReferenceSources(store:DataStore,tenantId:string,authority:unknown,analysis:Pick<WeeklyDirectorPlanningAnalysis,'benchmarkAccountRefs'|'benchmarkEvidenceRefs'|'ownedReferenceDiagnosis'>){
 const a=obj(authority),selected=obj(a?.referenceSelection)?.selected,handoffs=a?.selectedHandoffs;
 if(!Array.isArray(selected)||!selected.length||!Array.isArray(handoffs))throw new SocialContentWorkflowError('weekly_reference_source_missing',409);
 const result=[];
 const owned=analysis.benchmarkAccountRefs.some(ref=>ref.type==='owned_social_account');
 if(owned&&!analysis.ownedReferenceDiagnosis)throw new SocialContentWorkflowError('weekly_owned_reference_diagnosis_required',409);
 for(const value of selected){const candidate=obj(value),id=candidate?.candidateId;const matches=handoffs.map(obj).filter(h=>h?.inspirationId===id);const handoff=matches[0],rights=obj(handoff?.rights),source=obj(handoff?.source);
 if(matches.length!==1||typeof id!=='string'||rights?.mayAnalyze!==true||rights.mayAdapt!==true||typeof source?.sourceUrl!=='string'||!/^https?:\/\//.test(source.sourceUrl))throw new SocialContentWorkflowError('weekly_reference_rights_changed',409);
 const rows=await store.list<Record_>('trend_videos',{where:{tenantId,id},perPage:2});const row=rows.items[0];
 if(rows.totalItems!==1||!row||row.tenantId!==tenantId||row.id!==id||row.sourceUrl!==source.sourceUrl)throw new SocialContentWorkflowError('weekly_reference_catalog_identity_changed',409);
 let ownedProof:unknown=null;
 if(owned){const refs=analysis.benchmarkEvidenceRefs.filter(ref=>ref.startsWith('owned_content:'));if(refs.length!==1)throw new SocialContentWorkflowError('weekly_owned_reference_identity_changed',409);const original=await store.getById<Record_>('social_external_contents',refs[0]!.slice('owned_content:'.length)),content=obj(original?.content);const accounts=await store.list<Record_>('social_owned_accounts',{where:{tenant_id:tenantId,program_id:String(obj(a?.weeklyPackage)?.programId)},perPage:500});if(accounts.totalItems!==accounts.items.length)throw new SocialContentWorkflowError('weekly_owned_reference_identity_changed',409);const matching=accounts.items.filter(row=>{const account=obj(row.payload);return analysis.benchmarkAccountRefs.some(ref=>ref.id===account?.accountId&&ref.version===account.version)&&(account?.accountId===content?.accountId||account?.connectionId===content?.accountId);});if(!original||original.tenant_id!==tenantId||content?.tenantId!==tenantId||content.status!=='published'||content.publicUrl!==source.sourceUrl||content.accountId!==original.account_id||content.externalContentId!==original.external_content_id||content.channelId!==original.channel_id||matching.length!==1)throw new SocialContentWorkflowError('weekly_owned_reference_identity_changed',409);ownedProof={content,account:obj(matching[0]?.payload)};}
 result.push({sourceRef:source.sourceUrl,sourceVersion:socialRequestHash({record:{id:row.id,sourceUrl:row.sourceUrl,title:row.title,platform:row.platform,aiAnalysis:row.aiAnalysis,referenceShotReview:row.referenceShotReview,referenceVerifiedSpeech:row.referenceVerifiedSpeech},handoff,ownedProof}),label:typeof row.title==='string'?row.title:'冻结参考视频',record:row});
 }
 return result;
}
export function weeklyReferenceResolver(records:Awaited<ReturnType<typeof readWeeklyReferenceSources>>):SocialTaskReferenceResolver{return async input=>{
 for(const source of input.referenceSources){const matches=records.filter(record=>record.sourceRef===source.sourceRef&&record.sourceVersion===source.sourceVersion);if(matches.length!==1)throw new SocialContentWorkflowError('weekly_reference_version_changed',409);const resolved=buildSocialTaskReferencePackage({record:matches[0]!.record,source,themeId:input.themeId,verifiedContext:input.verifiedContext});if(resolved)return resolved;}
 return null;
};}
export function assertWeeklyReferenceBindings(detail:SocialContentTaskDetail,records:Awaited<ReturnType<typeof readWeeklyReferenceSources>>){const sources=detail.sources.filter(s=>s.kind==='reference_link'&&s.status==='active');if(sources.length!==records.length||records.some(r=>sources.filter(s=>s.sourceRef===r.sourceRef&&s.sourceVersion===r.sourceVersion).length!==1))throw new SocialContentWorkflowError('weekly_reference_version_changed',409);}
