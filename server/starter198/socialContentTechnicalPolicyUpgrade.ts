import type { SocialContentArtifact } from '../../shared/contracts/socialContentWorkflow.js';
import type { runSocialContentAutoProduction } from './socialContentProductionExecution.js';
import { createSocialArtifactReevaluationService } from './socialContentArtifactReevaluation.js';
import { SOCIAL_TECHNICAL_REVIEW_POLICY } from './socialContentTechnicalReplayEvidence.js';
import { STARTER_COLLECTIONS } from './repository.js';
import { socialObject, socialText } from './socialContentValidation.js';

type Input=Parameters<typeof runSocialContentAutoProduction>[0];
/** Existing artifacts still stop all supplier/production work. Only a local,
 * same-byte technical-policy migration may replace the review subject. */
export async function upgradeSocialArtifactTechnicalPolicy(input:Input,artifact:SocialContentArtifact,
  weekly:boolean,ports:{service?:typeof createSocialArtifactReevaluationService}={}):Promise<SocialContentArtifact>{
 const content=socialObject(artifact.content),source=socialObject(content?.productionWorkspaceSource);
 if(content?.workflowSchema!=='social-content.auto-production.v3'||source?.runId!==input.runId
   ||socialObject(content.technicalQualityReport)?.policyVersion===SOCIAL_TECHNICAL_REVIEW_POLICY)return artifact;
 if(weekly)throw Error('user_input_required:social_technical_reevaluation_weekly_cache_migration_required');
 const rows=await input.repository.list(STARTER_COLLECTIONS.socialContentArtifacts,input.tenantId,
  {where:{task_id:input.taskId,artifact_id:artifact.artifactId},perPage:2});
 if(rows.totalItems!==1||rows.items.length!==1)throw Error('user_input_required:social_technical_reevaluation_parent_missing');
 const parent=rows.items[0]!;
 const service=(ports.service||createSocialArtifactReevaluationService)({repository:input.repository,backendFilePort:input.runtime?.backendFilePort});
 try{
  return (await service.reevaluate({tenantId:input.tenantId,userId:input.userId,taskId:input.taskId,
   parentArtifactId:artifact.artifactId,parentArtifactVersion:String(parent.version),parentContentHash:socialText(parent.content_hash),
   expectedMediaSha256:socialText(source.outputSha256),expectedRunId:input.runId,mode:'technical',
   requestId:`technical-policy:${SOCIAL_TECHNICAL_REVIEW_POLICY}`})).artifact;
 }catch(error){
  const code=error instanceof Error?error.message:'';
  if(/^(?:social_technical_reevaluation_|scene_rework_|graph_context_snapshot_)[a-z_]+$/.test(code))throw Error(`user_input_required:${code}`);
  throw error;
 }
}
