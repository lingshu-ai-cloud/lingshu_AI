import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import type {PresenterBackgroundFirstEvidence,PresenterOriginalSceneFirstEvidence} from '../../shared/contracts/presenterBackgroundFirst.js';
import {firstFrameInputFingerprint,validateFirstFrameRequest,type FirstFrameRequest,type FirstFrameGenerator,type FirstFrameReference} from '../lib/firstFrameGenerator.js';
import {SeedreamFirstFrameGenerator} from '../lib/seedreamFirstFrameGenerator.js';
import type {SocialPaidOperationIntent} from '../lib/socialContentTaskBudgetAuthority.js';
import type {SocialTaskBudgetScope} from '../lib/socialContentTaskBudget.js';
import type {createSocialContentPaidOperationPermit,SocialPaidExecutionDependency} from '../lib/socialContentPaidOperationPermit.js';
import {inspectStoryboardAigcFramesWithQwen} from '../agents/qwen.js';
import {inspectStoryboardTechnicalFrames} from '../lib/storyboardAigcQuality.js';
import {evaluateStoryboardFirstFrameQuality} from '../lib/storyboardFirstFrameQualityEvaluation.js';
import {tenantAssetRelativePath,tenantAssetDir} from '../lib/assetAccess.js';
import {measureQwenRequestInputUpperBound} from './socialContentPaidRuntimePorts.js';
import {paidProductionHash} from './socialContentPaidOperationPlan.js';
import {preparePaidPresenterImage,preparePaidPresenterInspection,writePresenterArtifactFile} from './socialContentPresenterImageArtifact.js';

import {socialRequestHash} from './socialContentValidation.js';

type Image=Omit<FirstFrameReference,'role'>;
export interface PresenterBackgroundFirstInput {
 scope:SocialTaskBudgetScope;groupId:string;presenterAssetId:string;presenterAssetVersion:number;
 ratio:FirstFrameRequest['ratio'];sceneDescription:string;
 source:Image;person:Image;products:Array<Image&{assetId:string}>;
 intents:{background:SocialPaidOperationIntent|SocialPaidOperationIntent[];backgroundQa:SocialPaidOperationIntent|SocialPaidOperationIntent[];composite:SocialPaidOperationIntent|SocialPaidOperationIntent[];compositeQa:SocialPaidOperationIntent|SocialPaidOperationIntent[]};
 permit:ReturnType<typeof createSocialContentPaidOperationPermit>;mediaRoot:string;artifactRoot:string;
 assertProviderBinding:(route:{stage:string;provider:string;model:string;accountRef:string})=>Promise<void>;
 generator?:FirstFrameGenerator;inspect?:typeof inspectStoryboardAigcFramesWithQwen;
}
export type PresenterOriginalSceneFirstInput=Omit<PresenterBackgroundFirstInput,'source'|'sceneDescription'>&{
 source:{kind:'original_scene';sceneContractHash:string;promptHash:string};scenePrompt:string;
};
export async function preparePresenterOriginalSceneFirst(input:PresenterOriginalSceneFirstInput):Promise<PresenterOriginalSceneFirstEvidence>{
 if(input.source.kind!=='original_scene'||!/^[a-f0-9]{64}$/.test(input.source.sceneContractHash)||socialRequestHash(input.scenePrompt)!==input.source.promptHash)
  throw Error('presenter_original_scene_prompt_changed');
 return preparePresenterStaticScene({...input,sceneDescription:input.scenePrompt,source:undefined,originalSource:input.source}) as Promise<PresenterOriginalSceneFirstEvidence>;
}
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const dependency=(operationId:string,receiptRef:string,artifactSha256:string)=>({operationId,receiptRef,artifactSha256});

export async function assertPresenterBackgroundAssets(evidence:PresenterBackgroundFirstEvidence|PresenterOriginalSceneFirstEvidence,tenantId:string,mediaRoot:string):Promise<void>{
 const root=path.resolve(tenantAssetDir(mediaRoot,tenantId));
 for(const artifact of [evidence.background,evidence.composite]){
  const url=new URL(artifact.artifactRef,'http://local.invalid');
  const file=path.resolve(mediaRoot,decodeURIComponent(url.pathname.replace(/^\/media\//,'')));
  if(url.origin!=='http://local.invalid'||url.search||url.hash||!url.pathname.startsWith('/media/')||!file.startsWith(root+path.sep))throw Error('presenter_background_artifact_not_owned');
  const bytes=await fs.readFile(file);if(sha(bytes)!==artifact.sha256)throw Error('presenter_background_artifact_changed');
  let metadata;try{metadata=await sharp(bytes).metadata();}catch{throw Error('presenter_background_artifact_changed');}
  if(metadata.width!==artifact.width||metadata.height!==artifact.height)throw Error('presenter_background_artifact_changed');
 }
}

/** Four funded steps inside the existing assets node. A failed QA never
 * creates a child image; all completed steps recover through the original
 * image/inspection artifacts and permit, including after an approval-write crash.
 */
export function preparePresenterBackgroundFirst(input:PresenterBackgroundFirstInput):Promise<PresenterBackgroundFirstEvidence>{
 return preparePresenterStaticScene(input) as Promise<PresenterBackgroundFirstEvidence>;
}
async function preparePresenterStaticScene(input:Omit<PresenterBackgroundFirstInput,'source'>&{source?:Image;originalSource?:PresenterOriginalSceneFirstInput['source']}):Promise<PresenterBackgroundFirstEvidence|PresenterOriginalSceneFirstEvidence>{
 const original=Boolean(input.originalSource);
 const list=(value:SocialPaidOperationIntent|SocialPaidOperationIntent[])=>Array.isArray(value)?value:[value];
 const backgrounds=list(input.intents.background),backgroundQas=list(input.intents.backgroundQa),composites=list(input.intents.composite),compositeQas=list(input.intents.compositeQa);
 const chain=[...backgrounds,...backgroundQas,...composites,...compositeQas];
 const policySets=(intent:SocialPaidOperationIntent)=>{const policy=intent.executionBindingPolicy;return policy?.schemaVersion==='paid-execution-binding-policy.v1'?[policy.parentOperationIds]:policy?.allowedParentOperationSets??[];};
 const allows=(intent:SocialPaidOperationIntent,parents:string[])=>policySets(intent).some(set=>paidProductionHash([...set].sort())===paidProductionHash([...parents].sort()));
 const expectedCompositeSets=(attempt:number)=>backgrounds.map((item,index)=>[item.operationId,backgroundQas[index]!.operationId,...(attempt?[composites[attempt-1]!.operationId,compositeQas[attempt-1]!.operationId]:[])]);
 const exactSets=(actual:string[][],expected:string[][])=>paidProductionHash(actual.map(set=>[...set].sort()).sort())===paidProductionHash(expected.map(set=>[...set].sort()).sort());
 if(!backgrounds.length||backgrounds.length>2||backgrounds.length!==backgroundQas.length||!composites.length||composites.length>2||composites.length!==compositeQas.length
  ||new Set(chain.map(intent=>intent.operationId)).size!==chain.length
  ||backgrounds.some((intent,index)=>intent.provider!=='seedream'||intent.stage!=='first_frame'||!allows(intent,index?[backgrounds[index-1]!.operationId,backgroundQas[index-1]!.operationId]:[]))
  ||backgroundQas.some((intent,index)=>intent.provider!=='qwen'||intent.stage!=='first_frame_qa'||!allows(intent,[backgrounds[index]!.operationId]))
  ||composites.some((intent,index)=>intent.provider!=='seedream'||intent.stage!=='first_frame'||!exactSets(policySets(intent),expectedCompositeSets(index)))
  ||compositeQas.some((intent,index)=>intent.provider!=='qwen'||intent.stage!=='first_frame_qa'||!allows(intent,[composites[index]!.operationId])))throw Error('presenter_background_paid_plan_invalid');
 const geometry=original?`目标画幅 ${input.ratio}；按冻结场景规划生成自然完整环境，禁止黑边、白边、文字或水印。${input.sceneDescription}`:`目标画幅 ${input.ratio}；保持原场景、机位、景别、透视与构图意图。允许为目标画幅自然延展环境，禁止黑边、白边和缩在画布内的横框。${input.sceneDescription}`;
 function request(mode:'environment_plate'|'presenter_replace'|'storyboard_scene',references:FirstFrameReference[],prompt:string,intent:SocialPaidOperationIntent):FirstFrameRequest{
  const value:FirstFrameRequest={referenceMode:mode,tenantId:input.scope.tenantId,videoId:input.scope.taskId,compositionId:`${input.groupId}:${mode}`,presenterVersion:`${input.presenterAssetId}:${input.presenterAssetVersion}`,ratio:input.ratio,prompt,references,idempotencyKey:''};
  value.idempotencyKey=firstFrameInputFingerprint(value,'seedream',intent.model);return value;
 }
 async function image(intent:SocialPaidOperationIntent,request:FirstFrameRequest,parents:SocialPaidExecutionDependency[],phase:'background'|'composite'){
  const generated=await preparePaidPresenterImage({scope:input.scope,intent,requestFingerprint:request.idempotencyKey,root:input.artifactRoot,permit:input.permit,parentArtifacts:parents,generate:async executionBindingHash=>{
   await input.assertProviderBinding(intent);let boundary=false;
   validateFirstFrameRequest(request);
   const beforeSubmit=async(body:Record<string,unknown>)=>{const{maximumUnits,...binding}=intent;await input.permit.beforeSubmit({...binding,executionBindingHash,actualUnits:{inputImages:Array.isArray(body.image)?body.image.length:0,outputImages:1}});boundary=true;};
   if(input.generator)await beforeSubmit({image:request.references});
   const result=await(input.generator??new SeedreamFirstFrameGenerator({model:intent.model,beforeSubmit})).generate(request);
   if(!boundary)throw Error('presenter_first_frame_paid_boundary_missing');return result;
  }});
  const metadata=await sharp(generated.bytes,{failOn:'error'}).metadata(),[w,h]=input.ratio.split(':').map(Number);
  if(!metadata.width||!metadata.height||metadata.width<64||metadata.height<64||Math.abs(metadata.width*h!-metadata.height*w!)>Math.max(w!,h!))throw Error('presenter_first_frame_target_ratio_mismatch');
  if(metadata.hasAlpha&&(await sharp(generated.bytes).stats()).channels.at(-1)!.min<255)throw Error('presenter_background_transparent_output');
  const hash=sha(generated.bytes),extension=generated.mimeType==='image/png'?'png':generated.mimeType==='image/webp'?'webp':'jpg';
  const relative=tenantAssetRelativePath(input.scope.tenantId,`presenter-first-frames/${input.scope.runId}-${input.groupId}-${phase}-${hash.slice(0,16)}.${extension}`);
  await writePresenterArtifactFile(path.join(input.mediaRoot,relative),generated.bytes);
  return{...generated,sha256:hash,artifactRef:`/media/${relative}`,width:metadata.width,height:metadata.height};
 }
 async function inspect(intent:SocialPaidOperationIntent,candidate:Image,environment:Image|undefined,phase:'background'|'composite',parents:SocialPaidExecutionDependency[]){
  const isBackground=phase==='background',label=isBackground?'候选背景':'候选首帧',environmentLabel=isBackground?'原分镜场景参考':'已检验背景';
  const products=isBackground?[]:input.products;
  const references=[...(environment?[environmentLabel]:[]),...(!isBackground?['企业人物身份参考',...products.map(item=>`企业产品图:${item.assetId}`)]:[])];
  const report=await preparePaidPresenterInspection({scope:input.scope,intent,inputFingerprint:paidProductionHash({candidate:candidate.sha256,environment:environment?.sha256??null,person:isBackground?null:input.person.sha256,products:products.map(item=>item.sha256),geometry,phase,policy:original?'presenter-background-first.v3':'presenter-background-first.v2',originalSource:input.originalSource??null}),root:input.artifactRoot,permit:input.permit,parentArtifacts:parents,evaluate:async executionBindingHash=>{
   await input.assertProviderBinding(intent);let providerReceipt:unknown=null,boundary=false;
   const evaluation=await evaluateStoryboardFirstFrameQuality({sceneType:'general',hasProduct:products.length>0,hasNamedPerson:!isBackground,hasEnvironmentReference:Boolean(environment),hasContact:products.length>0,hasAction:products.length>0,personRemovalRequired:isBackground&&!original,personAbsenceRequired:isBackground&&original,naturalCompositeRequired:!isBackground,candidateLabels:[label],referenceLabels:references,applyReplicationAutomation:false,
    inspectTechnical:()=>inspectStoryboardTechnicalFrames('first_frame',[{bytes:candidate.bytes,timeLabel:label}]),
    inspectVisual:()=>(input.inspect??inspectStoryboardAigcFramesWithQwen)({model:intent.model,boundedPaidQa:true,personRemovalRequired:isBackground&&!original,personAbsenceRequired:isBackground&&original,naturalCompositeRequired:!isBackground,phase:'first_frame',sceneType:'general',storyboard:geometry,productInfo:isBackground?(original?'原创空场景：核验画面符合规划场景、无人物、规格正确、无文字或水印；没有参考图，不判断去人或原场景还原。':'空场景：原人物必须已去除；不证明企业场地归属。'):'人物、环境的光照、透视和接触关系必须自然一致；不得使用透明人物层后期叠加。',frames:[{base64:candidate.bytes.toString('base64'),mimeType:candidate.mimeType,timeLabel:label}],environmentReferences:environment?[{base64:environment.bytes.toString('base64'),mimeType:environment.mimeType,timeLabel:environmentLabel}]:[],personReferences:isBackground?[]:[{base64:input.person.bytes.toString('base64'),mimeType:input.person.mimeType,timeLabel:'企业人物身份参考'}],productReferences:products.map(item=>({base64:item.bytes.toString('base64'),mimeType:item.mimeType,timeLabel:`企业产品图:${item.assetId}`})),paidSubmission:async body=>{const{maximumUnits,...binding}=intent;await input.permit.beforeSubmit({...binding,executionBindingHash,actualUnits:{inputTokens:await measureQwenRequestInputUpperBound(body),outputTokens:Number(body.max_tokens)}});boundary=true;},onReceipt:value=>{providerReceipt=value;}})});
   if(!boundary||!providerReceipt)throw Error('presenter_first_frame_qa_receipt_missing');return{evaluation,providerReceipt};
  }});
  const passed=report.evaluation.firstFrameQualityState==='evaluated'&&report.evaluation.firstFrameQuality.automatedPassed;
  return{operationId:intent.operationId,passed,receiptRef:report.receiptRef,reportHash:report.reportHash};
 }
 // Check every selected route before purchasing any new step. Cached artifacts
 // are still allowed to recover when only the live provider is unavailable.
 if(await input.permit.isProvenUnsubmitted?.(backgrounds[0]!.operationId))for(const intent of chain)await input.assertProviderBinding(intent);
 let selectedBackground:null|{operationId:string;image:Awaited<ReturnType<typeof image>>;qa:Awaited<ReturnType<typeof inspect>>;dependencies:SocialPaidExecutionDependency[]}=null;
 let previousBackground:SocialPaidExecutionDependency[]=[];
 for(let attempt=0;attempt<backgrounds.length;attempt++){
  const background=backgrounds[attempt]!,backgroundQa=backgroundQas[attempt]!;
  const correction=attempt&&original?'上一候选未通过规划场景、无人或规格质量检查，重新生成并修复。':attempt?'上一候选未通过人物移除或场景质量检查。重新生成不同候选，重点修复人物残影、身体残片、错误补景和构图漂移。':'';
  const bg=await image(background,request(original?'storyboard_scene':'environment_plate',original?[]:[{role:'source_composition',...input.source!}],original?`${geometry}${correction}只生成规划环境背景，场景中不得出现人物、身体残片或人物倒影，不新增文字或水印。`:`${geometry}${correction}移除原人物、身体残片及人物倒影，修复被遮挡的背景；移除与人物连带的手持前景物体，保留环境结构和光照。不添加人物、产品、文字或水印。`,background),previousBackground,'background');
  const bgDependency=dependency(background.operationId,bg.receiptRef,bg.sha256),bgQa=await inspect(backgroundQa,bg,input.source,'background',[bgDependency]);
  if(bgQa.passed){selectedBackground={operationId:background.operationId,image:bg,qa:bgQa,dependencies:[bgDependency,dependency(backgroundQa.operationId,bgQa.receiptRef,bgQa.reportHash)]};break;}
  previousBackground=[bgDependency,dependency(backgroundQa.operationId,bgQa.receiptRef,bgQa.reportHash)];
 }
 if(!selectedBackground)throw Error('presenter_background_quality_failed');
 const bg=selectedBackground.image,bgQa=selectedBackground.qa;
 const refs:FirstFrameReference[]=[{role:'source_composition',...bg},{role:'authorized_presenter',...input.person},...input.products.map(item=>({role:'product_identity' as const,...item}))];
 let selectedComposite:null|{operationId:string;image:Awaited<ReturnType<typeof image>>;qa:Awaited<ReturnType<typeof inspect>>}=null,previousComposite:SocialPaidExecutionDependency[]=[];
 for(let attempt=0;attempt<composites.length;attempt++){
  const composite=composites[attempt]!,compositeQa=compositeQas[attempt]!;
  const correction=attempt?'上一候选未通过人物融合质量检查。重新生成不同候选，重点修复身份漂移、光线、色温、透视、遮挡和接触阴影。':'';
  const parents=[...selectedBackground.dependencies,...previousComposite];
  if(!allows(composite,parents.map(parent=>parent.operationId)))throw Error('presenter_background_paid_plan_invalid');
  const fg=await image(composite,request('presenter_replace',refs,`${geometry}${correction}图一为${original?'按规划生成的无人':'已去人的'}合格背景，图二仅提供已授权企业人物的身份。请生成完整自然画面，让人物处于规划构图位置，并协调人物和场景的光照方向、色温、透视、遮挡和接触阴影；禁止透明抠像或贴图效果。${input.products.length?'展示或接触的产品采用后续企业产品参考图，不改变包装、标识和比例。':'不新增产品或道具。'}不新增文字或水印。`,composite),parents,'composite');
  const fgDependency=dependency(composite.operationId,fg.receiptRef,fg.sha256),fgQa=await inspect(compositeQa,fg,bg,'composite',[fgDependency]);
  if(fgQa.passed){selectedComposite={operationId:composite.operationId,image:fg,qa:fgQa};break;}
  previousComposite=[fgDependency,dependency(compositeQa.operationId,fgQa.receiptRef,fgQa.reportHash)];
 }
 if(!selectedComposite)throw Error('presenter_composite_quality_failed');
 const fg=selectedComposite.image,fgQa=selectedComposite.qa;
 if(original)return{schemaVersion:'presenter-background-first.v3',aspectRatio:input.ratio,source:input.originalSource!,background:{width:bg.width,height:bg.height,artifactRef:bg.artifactRef,sha256:bg.sha256,createdAt:bg.createdAt,operationId:selectedBackground.operationId,receiptRef:bg.receiptRef,qa:bgQa},composite:{width:fg.width,height:fg.height,artifactRef:fg.artifactRef,sha256:fg.sha256,plateSha256:bg.sha256,presenterAssetId:input.presenterAssetId,presenterAssetVersion:input.presenterAssetVersion,createdAt:fg.createdAt,operationId:selectedComposite.operationId,receiptRef:fg.receiptRef,qa:fgQa}};
 return{schemaVersion:'presenter-background-first.v2',aspectRatio:input.ratio,sourceFirstFrameSha256:input.source!.sha256,background:{width:bg.width,height:bg.height,artifactRef:bg.artifactRef,sha256:bg.sha256,sourceFirstFrameSha256:input.source!.sha256,personRemovalMethod:'seedream_environment_plate',createdAt:bg.createdAt,operationId:selectedBackground.operationId,receiptRef:bg.receiptRef,qa:bgQa},composite:{width:fg.width,height:fg.height,artifactRef:fg.artifactRef,sha256:fg.sha256,plateSha256:bg.sha256,presenterAssetId:input.presenterAssetId,presenterAssetVersion:input.presenterAssetVersion,createdAt:fg.createdAt,operationId:selectedComposite.operationId,receiptRef:fg.receiptRef,qa:fgQa}};
}
