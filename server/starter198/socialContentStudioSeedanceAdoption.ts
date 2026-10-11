import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import type {DataStore} from '../storage/datastore.js';
import {readContentExecutionJob} from '../contentExecution/durableQueue.js';
import {buildStoryboardQaReport,applyStoryboardReplicationAutomation} from '../lib/storyboardAigcQuality.js';
import {storyboardProjectShotInput} from '../lib/storyboardProjectShotInput.js';
import {StoryboardAigcProjectBudget} from '../lib/storyboardAigcProjectBudget.js';
import {socialJson,socialObject,socialRequestHash} from './socialContentValidation.js';
import type {StudioAdoptionScope,StudioCompletedAssetEvidence} from './socialContentStudioAdoption.js';
/** Read only canonical server result/QA files and the original Studio budget receipt.
 * No GET polling, download, generation, budget mutation or material registration. */
export async function readCompletedStudioSeedanceAdoptionEvidence(input:{dataStore:DataStore;scope:StudioAdoptionScope;projectId:string;authorityRoot?:string;operationId?:string}):Promise<StudioCompletedAssetEvidence|null>{
const {scope}=input,root=input.authorityRoot??process.cwd();
const project=await input.dataStore.getById<Record<string,unknown>>('studio_projects',input.projectId),spec=socialObject(socialJson(project?.spec));
const job=await readContentExecutionJob(input.dataStore,scope.tenantId,scope.taskId,scope.runId),binding=socialObject(job?.checkpoints['social.executor']?.payload),approved=socialObject(binding?.approvedContext);
if(!project||project.tenant_id!==scope.tenantId||spec?.socialContentTaskId!==scope.taskId||spec?.workflowRunId!==scope.runId||job?.id!==scope.jobId||Number(spec?.taskVersion)!==Number(approved?.version))throw Error('studio_seedance_adoption_scope_changed');
const originalOperation=`mvp-studio:${input.projectId}:S04:video:v${spec.taskVersion}`;
const operationId=input.operationId??originalOperation;
if(operationId!==originalOperation&&(!operationId.startsWith(originalOperation+':repair-')||!/^\d+$/.test(operationId.slice((originalOperation+':repair-').length))||Number(operationId.slice((originalOperation+':repair-').length))<1))throw Error('studio_seedance_operation_scope_changed');
const ledger=await new StoryboardAigcProjectBudget(path.join(root,'data/storyboard-aigc-budget')).status(scope.tenantId,input.projectId);
const entry=ledger.entries.find(value=>value.operationId===operationId);if(!entry||entry.status!=='completed')return null;
const output=socialObject(entry.output),providerTaskId=String(output?.providerTaskId||''),fingerprint=String(output?.seedanceInputFingerprint||'');if(!providerTaskId||!fingerprint)throw Error('studio_seedance_completion_receipt_incomplete');
const file=path.join(root,'data/mvp-studio-video-results',`S04-${providerTaskId.replace(/[^a-zA-Z0-9_-]/g,'_')}.mp4`),qaFile=file+'.qa.json';if(!fs.existsSync(qaFile)||!fs.existsSync(file))return null;
const currentShot=storyboardProjectShotInput(spec,'S04');if(!currentShot)throw Error('studio_seedance_current_shot_missing');
const frozenSupply=(approved?.assetSupplyPlan as {shots?:Array<{shotId:string;requestedDescription:string}>})?.shots?.find(value=>value.shotId==='S04');
const currentVisual=/^Visual: (.*)$/m.exec(currentShot.input.detail)?.[1]?.trim();
if(!frozenSupply||currentVisual!==frozenSupply.requestedDescription)throw Error('studio_seedance_frozen_visual_changed');
const receiptBytes=fs.readFileSync(qaFile),receipt=JSON.parse(receiptBytes.toString('utf8'));
if(receipt.tenantId!==scope.tenantId||receipt.projectId!==input.projectId||receipt.taskId!==scope.taskId||receipt.runId!==scope.runId||Number(receipt.version)!==Number(spec.taskVersion)||receipt.shotId!=='S04'||receipt.providerTaskId!==providerTaskId||receipt.inputFingerprint!==fingerprint||receipt.filePath!==file||receipt.actualCostCny!==null||!/^[a-f0-9]{64}$/.test(String(receipt.sourceProductSha256))||receipt.description!==currentShot.input.detail||receipt.productInfo!==spec.productInfo||!receipt.canAdopt||!receipt.quality?.passed||!receipt.qaFingerprint)throw Error('studio_seedance_QA_receipt_invalid');
const recomputed=applyStoryboardReplicationAutomation(buildStoryboardQaReport({phase:'video',sceneType:'product',hasProduct:true,hasNamedPerson:false,hasContact:true,hasAction:true,observations:Object.values(receipt.quality.checks??{}),evidenceFrameLabels:receipt.quality.evidenceFrameLabels??[]}));
if(!recomputed.passed||receipt.quality.version!=='storyboard-aigc-qa-v1'||receipt.quality.phase!=='video'||receipt.quality.requiresHumanReview)throw Error('studio_seedance_QA_observations_invalid');
const workflow=socialObject(approved?.agentWorkflow),execution=socialObject(workflow?.executionPlan),scene=(execution?.scenes as Array<Record<string,unknown>>)?.find(value=>value.sceneId==='S04');if(!scene||scene.selectedSourceStrategy!=='aigc_product_scene_replication')throw Error('studio_seedance_frozen_route_changed');
const qaRef=`studio_video_QA:${receipt.qaFingerprint}`,authorizationRef=`task_production_authority:${scope.taskId}:${approved?.revisionPlanHash}`;
const asset={id:`studio-adopted-seedance-${providerTaskId}`,name:'Studio generated owned-product hero',type:'video' as const,sourceId:`seedance:${providerTaskId}`,url:file,localPath:file,contentHash:receipt.outputSha256,providerId:'seedance',providerTaskId,duration:receipt.durationSeconds,visualObservations:['Real completed silent owned-product hero; source-bound canonical video QA passed'],segments:[{providerTaskId,model:output?.providerModel,quality:receipt.quality,actualCostCny:null,inputFingerprint:fingerprint,sourceFirstFrameMaterialId:output?.firstFrameMaterialId}]};
return {...scope,projectId:input.projectId,shotId:'S04',graphInputHash:String(binding?.inputHash),revisionPlanHash:String(approved?.revisionPlanHash),frozenShotHash:socialRequestHash(scene),providerId:'seedance',providerTaskId,providerReceiptRef:`studio_budget:${operationId}`,providerReceiptHash:createHash('sha256').update(JSON.stringify(entry)).digest('hex'),providerStatus:'completed',budgetReceiptRef:`studio_budget:${operationId}`,budgetStatus:'completed',actualCostCny:null,usageEvidenceRef:output?.usage ? `studio_provider_usage:${socialRequestHash(output.usage)}` : null,asset,mediaSha256:receipt.outputSha256,durationSeconds:receipt.durationSeconds,quality:{status:'passed',evidenceRefs:[qaRef,`studio_QA_receipt_sha256:${createHash('sha256').update(receiptBytes).digest('hex')}`],mediaSha256:receipt.outputSha256},authorizationRef,sourceReceiptRefs:[`product_source_sha256:${receipt.sourceProductSha256}`,`studio_first_frame:${output?.firstFrameMaterialId}`,`studio_input:${fingerprint}`]};
}
