import {recordCurrentContentExecutionCheckpoint} from '../contentExecution/context.js';
import {freezePresenterMotherSegments} from '../../shared/contracts/presenterMotherSegments.js';
import type {SocialAssetSupplyPlan,SocialDirectorBrief} from '../../shared/contracts/socialContentWorkflow.js';
import type {StoredSocialScriptBaseline} from './socialContentScriptBaseline.js';
import type {ProductionBudgetReadPorts} from './socialContentProductionBudgetPreflight.js';
import type {runSocialContentAutoProduction} from './socialContentProductionExecution.js';
import type {readSocialTaskDetail} from './socialContentRecords.js';
import {buildSocialPresenterSceneSources} from './socialContentPresenterSceneSource.js';
import {assertSocialReferenceBackgroundAssetCurrent} from './socialContentReferenceBackgroundLock.js';
import {automaticallyConfirmPresenterFirstFrameApproval} from './socialContentPresenterFirstFrameApproval.js';
import {writeExecutionStage} from './socialContentProductionRuntimeSupport.js';
import {socialRequestHash} from './socialContentValidation.js';

/** Reuse the existing static executor, with the same final timing as its paid plan. */
export function createSocialProductionFirstFramePreparation(context:{
 execution:Parameters<typeof runSocialContentAutoProduction>[0];
 detail:NonNullable<Awaited<ReturnType<typeof readSocialTaskDetail>>>;
 baseline:StoredSocialScriptBaseline;supplyPlan:SocialAssetSupplyPlan|null;
 directorScenes:()=>SocialDirectorBrief['scenes'];assertNewSubmit:()=>Promise<void>;
}):NonNullable<ProductionBudgetReadPorts['preparePresenterFirstFrameReviews']>{
 const {execution:input,detail,baseline:activeBaseline,supplyPlan:reviewedSupplyPlan}=context;
 return async({scope,groups,requirements,intents,paidPermit,directorScenes:measuredDirectorScenes})=>{

        if(!groups.length)return;
        const referenceAnalysis=detail.referenceVideoAnalysis;
        const directorScenes=measuredDirectorScenes??context.directorScenes();
        if(!input.runtime?.preparePresenterMotherFirstFrames)throw Error('presenter_first_frame_preparation_port_missing');
        const baselineById=new Map(activeBaseline.scenes.map(scene=>[scene.sceneId,scene]));
        const speechGroups=groups.filter(group=>group.executionKind!=='seedance_motion');
        const emptyGrouping={schemaVersion:'presenter-mother-segments.v1' as const,taskId:input.taskId,referenceAnalysisHash:socialRequestHash(referenceAnalysis??null),sourceSlotCount:directorScenes.length,groups:[]};
        const grouping=speechGroups.length?freezePresenterMotherSegments({taskId:input.taskId,referenceAnalysisHash:socialRequestHash(referenceAnalysis??null),slots:directorScenes.map(scene=>{const frozen=speechGroups.find(group=>group.shotIds.includes(scene.sceneId));return{slotId:scene.sceneId,referenceShotId:scene.referenceShotId||scene.sceneId,startSeconds:scene.duration.startSeconds,endSeconds:scene.duration.endSeconds,spokenText:baselineById.get(scene.sceneId)?.voiceover||baselineById.get(scene.sceneId)?.narration||'',materialType:frozen?'talking_head':'unknown',frontFacing:Boolean(frozen),lipSyncRequired:Boolean(frozen),...(frozen?.visualCompatibilityHash?{visualCompatibilityHash:frozen.visualCompatibilityHash}:{})};})}):{...emptyGrouping,recordHash:socialRequestHash(emptyGrouping)};
        const supplyById=new Map((reviewedSupplyPlan?.shots??[]).map(shot=>[shot.shotId,shot]));
        const factVersion=activeBaseline.enterpriseFactVersion;
        const sceneSources=buildSocialPresenterSceneSources({groups,directorScenes:directorScenes,reference:referenceAnalysis,aspectRatio:detail.brief.aspectRatio||'9:16'});
        const approvalGroups=groups.map((frozen,index)=>{const locks=frozen.shotIds.map(id=>supplyById.get(id)?.enterpriseProductAssetLock).filter(Boolean) as NonNullable<NonNullable<typeof reviewedSupplyPlan>['shots'][number]['enterpriseProductAssetLock']>[];const uniqueLocks=[...new Map(locks.map(lock=>[socialRequestHash(lock),lock])).values()];if(uniqueLocks.length>1)throw Error(`presenter_first_frame_product_lock_ambiguous:${frozen.groupId}`);const lock=uniqueLocks[0];return{groupId:frozen.groupId,presenterGroupContractHash:frozen.contractHash,presenterAssetId:frozen.presenterAssetId,executionKind:frozen.executionKind,firstFramePipeline:frozen.firstFramePipeline,...(lock?{productAssetBinding:{...lock,enterpriseFactVersion:factVersion?`${factVersion.id}:${factVersion.revision}:${factVersion.contentHash}`:lock.enterpriseFactRef}}:{}),compositions:sceneSources[index]!.compositions.map((value,sourceIndex)=>{if(frozen.executionKind!=='seedance_motion')return value;if(!('referenceShotId' in value))throw Error('presenter_motion_reference_source_required');const background=assertSocialReferenceBackgroundAssetCurrent({lock:supplyById.get(frozen.shotIds[sourceIndex]!)?.referenceBackgroundAssetLock,referenceReuse:detail.brief.referenceReuse,referenceAnalysis:detail.referenceVideoAnalysis,expectedReferenceShotId:value.referenceShotId});return {...value,referenceSourceId:background.referenceSourceId,startSeconds:background.startSeconds,endSeconds:background.endSeconds,referenceFirstFrameUrl:background.firstFrameRef};})};});
        // This runtime hook is server-injected and may submit a static supplier
        // before using the paid permit. Recheck the frozen weekly claim at its
        // invocation boundary; the permit independently checks each bound POST.
        if(groups.some(group=>group.firstFramePipeline!=='background-first.v2'))await context.assertNewSubmit();
        const reviewNodes=await input.runtime.preparePresenterMotherFirstFrames({scope,grouping,targetAspectRatio:detail.brief.aspectRatio || '9:16',groups:approvalGroups,paidStatic:{requirements,intents,permit:paidPermit}});
        if(!input.repository.dataStore)throw Error('presenter_first_frame_automatic_confirmation_store_missing');
        const decisions=await Promise.all(reviewNodes.map(node=>automaticallyConfirmPresenterFirstFrameApproval(input.repository.dataStore!,{scope,groupId:node.groupId,expectedRecordHash:node.recordHash})));
        const nativeSourceOnly=reviewNodes.some(node=>node.sourceMode==='heygen_catalog_native'),reviewHash=socialRequestHash({scope,groupingHash:grouping.recordHash,nodes:reviewNodes.map(node=>node.recordHash)});
        await recordCurrentContentExecutionCheckpoint({stage:'social.presenter_first_frames',version:'2',inputHash:reviewHash,payload:{status:nativeSourceOnly?'catalogue_source_confirmed_visual_review_pending':'automatically_confirmed_after_static_qa',groupingHash:grouping.recordHash,reviewNodes,decisionRecordHashes:decisions.map(node=>node.recordHash)}});
        await writeExecutionStage({...input,stage:'presenter_first_frames_automatically_confirmed',message:nativeSourceOnly?'已核验 HeyGen 原人物与音色，沿用人物原场景；构图与口型留待成片人工验收。':'人物母段首帧静态质检通过，系统已自动确认并继续动态生成。',extra:{groupIds:groups.map(group=>group.groupId),approvalRecordHashes:reviewNodes.map(node=>node.recordHash),decisionRecordHashes:decisions.map(node=>node.recordHash)}});
 };
}
