import { persistGraphEvidenceSnapshot } from './socialContentGraphContextSnapshots.js';
import { executeSocialQualityStage } from './socialContentProductionStages.js';
import { inspectRenderedScenes, inspectRenderedVisuals, runVisualFfmpeg } from '../lib/renderVisualQuality.js';
import { probeSocialSceneMedia } from './socialSceneMediaHardProbe.js';
import { hasSocialMeasuredMediaHardFailure } from './socialContentGraphQualityGate.js';
import { socialObject, socialRequestHash } from './socialContentValidation.js';
import { loadSocialTechnicalReplay, verifySocialTechnicalReplay, SOCIAL_TECHNICAL_REVIEW_POLICY,
  type SocialTechnicalReplayEvidence } from './socialContentTechnicalReplayEvidence.js';
import type { InitialSceneQualityReport } from './socialContentInitialSceneCache.js';
import type { Starter198Repository } from './repository.js';

type Scope={tenantId:string;taskId:string;runId:string};
export interface SocialTechnicalReevaluationResult { report:InitialSceneQualityReport;approved:boolean;failures:string[];policyVersion:string;evidenceHash:string; }
export async function reevaluateSocialTechnicalArtifact(input:{repository:Starter198Repository;scope:Scope;
 parentArtifactId:string;parentContent:Record<string,unknown>;outputSha256:string;outputVideoPath:string},ports:{
 load?:typeof loadSocialTechnicalReplay;verify?:typeof verifySocialTechnicalReplay;
 inspect?:typeof executeSocialQualityStage;probe?:typeof probeSocialSceneMedia;
}={}):Promise<SocialTechnicalReevaluationResult>{
 const evidence:SocialTechnicalReplayEvidence=await (ports.load||loadSocialTechnicalReplay)(input);
 const {manifest,receipt,frame}=await (ports.verify||verifySocialTechnicalReplay)({...input,evidence});
 const spec=socialObject(manifest.spec),raw=manifest.timeline;
 if(typeof spec?.duration!=='number'||!Number.isFinite(spec.duration)||spec.duration<=0||!Array.isArray(raw)||!raw.length)throw Error('social_technical_reevaluation_manifest_invalid');
 const scenes=raw.map(item=>{const row=socialObject(item);if(typeof row?.targetStart!=='number'||typeof row.targetEnd!=='number'
   ||!Number.isFinite(row.targetStart)||!Number.isFinite(row.targetEnd)||row.targetEnd<=row.targetStart)throw Error('social_technical_reevaluation_manifest_invalid');return {start:row.targetStart,end:row.targetEnd};});
 const quality=await (ports.inspect||executeSocialQualityStage)({outputPath:input.outputVideoPath,duration:spec.duration,scenes,expectedUniqueScenes:scenes.length,
  inspectVisuals:inspectRenderedVisuals,inspectScenes:inspectRenderedScenes,runFfmpeg:runVisualFfmpeg,
  checkpointEnabled:false,verifyDuration:true,...(evidence.bgm?{expectedBgm:{source:evidence.bgm.localPath,sourceHash:evidence.bgm.sha256,volume:typeof spec.bgmVol==='number'?spec.bgmVol:0}}:{})});
 const probe=await (ports.probe||probeSocialSceneMedia)({filePath:input.outputVideoPath,manifest,frozenVoiceCues:evidence.frozenVoiceCues,
  subtitleRenderEvidence:receipt.subtitleRenderEvidence,frameRenderEvidence:frame,
  captionMaskSources:{baselinePath:receipt.captionBaselineSidecar!.path,baselineSha256:receipt.captionBaselineSidecar!.sha256,
   assPath:receipt.subtitleAssSidecar!.path,assSha256:receipt.subtitleAssSidecar!.sha256}});
 await (ports.verify||verifySocialTechnicalReplay)({...input,evidence});
 if(probe.mediaSha256!==input.outputSha256||probe.timelineHash!==socialRequestHash(raw))throw Error('social_technical_reevaluation_probe_changed');
 const failures=[...quality.quality.failures,...quality.sceneQuality.issues.map(issue=>issue.reason),
  ...(!quality.audio.ok?['audio_decode_failed']:[]),...(quality.audio.bgm&&!quality.audio.bgm.passed?['bgm_check_failed']:[])];
 if(hasSocialMeasuredMediaHardFailure(probe))failures.push('measured_media_hard_failure');
 // This local replay does not obtain a new human lip/creative/privacy decision.
 // Unknown technical measurements remain unverified, never a successful pass.
 if(probe.scenes.length!==scenes.length||probe.scenes.some(scene=>scene.durationPassed!==true||scene.audioWindowDecoded!==true)
   ||probe.formatPassed!==true||probe.captionTimeline?.status!=='valid'||probe.captionSpeechAlignment?.status!=='matched'
   ||probe.fullFrozenAudioIdentity?.status!=='matched'||probe.finalPrivacyCoverage?.status!=='observed'
   ||probe.captionMaskAudit?.status!=='observed_mask_delta'||probe.captionMaskAudit.simplePixelProof?.status!=='matched')failures.push('technical_measurement_unverified');
 const report:InitialSceneQualityReport={schemaVersion:'initial-scene-quality.v1',policyVersion:SOCIAL_TECHNICAL_REVIEW_POLICY,
  replayEvidenceHash: persistGraphEvidenceSnapshot(evidence),
  visual:quality.quality,scenes:quality.sceneQuality,audio:{ok:quality.audio.ok&&(!quality.audio.bgm||quality.audio.bgm.passed),
   error:!quality.audio.ok?'成片音轨无法解码':quality.audio.bgm?.failure??null,...(quality.audio.bgm?{bgm:quality.audio.bgm}:{})},mediaHardProbe:probe,
  sourceTextReview:Array.isArray(manifest.sourceTextReview)?manifest.sourceTextReview as InitialSceneQualityReport['sourceTextReview']:[]};
 return {report,approved:quality.quality.passed&&quality.sceneQuality.passed&&failures.length===0,failures,
  policyVersion:SOCIAL_TECHNICAL_REVIEW_POLICY,evidenceHash:socialRequestHash(evidence)};
}

export function applySocialTechnicalReevaluation(parent:Record<string,unknown>,result:SocialTechnicalReevaluationResult){
 const content=structuredClone(parent),production=socialObject(content.productionResult)??{},render=socialObject(content.render)??{},review=socialObject(content.review)??{},delivery=socialObject(content.delivery)??{};
 const creativePassed=review.creativeChecksPassed===true;
 const passed=result.approved&&creativePassed;
 content.technicalQualityReport=result.report;
 content.productionResult={...production,technicalReview:{...socialObject(production.technicalReview),approved:result.approved,checkedScenes:result.report.scenes.checkedScenes,failures:result.failures}};
 content.render={...render,qualityPassed:result.approved,qualityMetrics:result.report.visual.metrics,checkedScenes:result.report.scenes.checkedScenes,audioDecoded:result.report.audio.ok};
 content.review={...review,state:passed?'requires_user_approval':'requires_revision',technicalChecksPassed:result.approved,automatedChecksPassed:passed};
 content.delivery={...delivery,status:passed?'publish_candidate':'requires_revision'};
 return content;
}
