import type { DataStore } from '../storage/datastore.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import { validatePresenterRightsEvidence } from '../lib/presenterAssetTrust.js';
import type { SocialContentAutoProductionRuntime } from './socialContentProductionExecution.js';
import {createPresenterFirstFrameApproval,type PresenterFirstFrameApprovalContract} from './socialContentPresenterFirstFrameApproval.js';
import {SeedreamFirstFrameGenerator} from '../lib/seedreamFirstFrameGenerator.js';
import {firstFrameInputFingerprint,type FirstFrameReference,type FirstFrameRequest} from '../lib/firstFrameGenerator.js';
import {inspectStoryboardAigcFramesWithQwen} from '../agents/qwen.js';
import {inspectStoryboardTechnicalFrames} from '../lib/storyboardAigcQuality.js';
import {evaluateStoryboardFirstFrameQuality} from '../lib/storyboardFirstFrameQualityEvaluation.js';
import {createProductionBudgetRouteReaders} from './socialContentProductionBudgetRoutes.js';
import {measureQwenRequestInputUpperBound} from './socialContentPaidRuntimePorts.js';
import {readLocalMaterials} from '../lib/materialLibrary.js';
import {readTenantMaterialBytes} from '../lib/sentenceReplicationProduction.js';
import {objectStorageDownload} from '../storage/objectStorage.js';
import {tenantAssetDir,tenantAssetRelativePath} from '../lib/assetAccess.js';
import {MEDIA_ROOT} from './socialContentAutoProduction.js';

type StoredPresenter = Record<string, unknown> & { id?: string; authorized?: boolean; assetVersion?: number; avatarId?: string; voiceId?: string; imageUrl?:string; referenceMaterialIds?:string[]; rightsEvidence?: unknown; toolMappings?: { heygen?: { avatarId?: string; voiceId?: string };runway?:{referenceMaterialIds?:string[]};sd?:{referenceMaterialIds?:string[]};seedance?:{referenceMaterialIds?:string[]} } };
export interface PresenterFirstFrameStaticResult {
  referenceCompositionHashes:string[];backgroundPlateSha256:string;
  personRemovalEvidence:{receiptRef:string;sourceSha256:string;outputSha256:string};
  compositeFirstFrameSha256:string;compositeFirstFrameUrl:string;
  qa:{passed:boolean;receiptRef:string;reportHash:string};createdAt:string;
}
export interface PresenterFirstFrameStaticExecutor {
  /** Must invoke paidStatic.permit.beforeSubmit immediately before each real
   * supplier POST and mark its actual provider receipt afterward. */
  prepare(input:Parameters<NonNullable<SocialContentAutoProductionRuntime['preparePresenterMotherFirstFrames']>>[0] & {group:Parameters<NonNullable<SocialContentAutoProductionRuntime['preparePresenterMotherFirstFrames']>>[0]['groups'][number];presenter:StoredPresenter;frameOperationId:string;qaOperationId:string}):Promise<PresenterFirstFrameStaticResult>;
}

type ImageBytes={bytes:Buffer;mimeType:'image/jpeg'|'image/png'|'image/webp';sha256:string};
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const imageMime=(value:string):ImageBytes['mimeType']=>/png/i.test(value)?'image/png':/webp/i.test(value)?'image/webp':'image/jpeg';
const compositionHash=(value:Record<string,unknown>)=>hash(JSON.stringify(value));
function intent(input:Parameters<PresenterFirstFrameStaticExecutor['prepare']>[0],operationId:string){
  const matches=input.paidStatic.intents.filter(item=>item.operationId===operationId);if(matches.length!==1)throw Error('presenter_first_frame_paid_intent_missing');return matches[0]!;
}
async function validImage(bytes:Buffer,mimeType:string):Promise<ImageBytes>{
  const metadata=await sharp(bytes,{failOn:'error'}).metadata();if(!metadata.width||!metadata.height||metadata.width<64||metadata.height<64)throw Error('presenter_first_frame_image_invalid');
  return{bytes,mimeType:imageMime(mimeType),sha256:hash(bytes)};
}
async function loadReferenceFrame(store:DataStore,tenantId:string,url:string):Promise<ImageBytes>{
  const parsed=url.match(/^\/api\/overseas\/videos\/([^/]+)\/shot\/(\d+)\/first-frame$/);
  if(!parsed)throw Error('presenter_first_frame_reference_url_unsupported');
  const record=await store.getById<Record<string,unknown>>('trend_videos',decodeURIComponent(parsed[1]!));
  if(!record||String(record.tenantId||'')!==tenantId)throw Error('presenter_first_frame_reference_not_owned');
  const raw=record.geminiAnalysis||record.aiAnalysis||record.analysis||record.gemini;
  let analysis:Record<string,unknown>={};try{analysis=typeof raw==='string'?JSON.parse(raw):raw&&typeof raw==='object'?raw as Record<string,unknown>:{};}catch{}
  const gemini=analysis.gemini&&typeof analysis.gemini==='object'?analysis.gemini as Record<string,unknown>:analysis;
  const details=Array.isArray(gemini.scriptDetails15s)?gemini.scriptDetails15s:[];
  const evidence=(details[Number(parsed[2])-1] as Record<string,unknown>|undefined)?.materialEvidence as Record<string,unknown>|undefined;
  const objectKey=String(evidence?.firstFrameObjectKey||'');
  if(objectKey){const object=await objectStorageDownload(objectKey);if(object?.buf.length)return validImage(object.buf,object.contentType);}
  const file=path.join(tenantAssetDir(MEDIA_ROOT,tenantId),'trend-shots',String(record.id||parsed[1]),`shot-${Number(parsed[2])}.jpg`);
  return validImage(await fs.readFile(file),'image/jpeg');
}
async function loadPresenterMaster(tenantId:string,presenter:StoredPresenter):Promise<ImageBytes>{
  const ids=[...(presenter.referenceMaterialIds||[]),...(presenter.toolMappings?.seedance?.referenceMaterialIds||[]),...(presenter.toolMappings?.sd?.referenceMaterialIds||[]),...(presenter.toolMappings?.runway?.referenceMaterialIds||[])];
  const material=readLocalMaterials().find(item=>ids.includes(String(item.id))&&item.type==='image'&&(item.scope==='shared'||String(item.tenantId||item.tenant_id||'')===tenantId));
  if(material){const loaded=await readTenantMaterialBytes(material,tenantId);return validImage(loaded.bytes,loaded.mimeType);}
  const url=String(presenter.imageUrl||'');
  if(url.startsWith('/media/')){const relative=decodeURIComponent(url.slice('/media/'.length));const file=path.resolve(MEDIA_ROOT,relative),root=path.resolve(tenantAssetDir(MEDIA_ROOT,tenantId));if(!file.startsWith(root+path.sep))throw Error('presenter_first_frame_master_not_owned');return validImage(await fs.readFile(file),path.extname(file));}
  if(/^https:\/\//.test(url)){const parsed=new URL(url);if(!/(^|\.)heygen\.(com|ai)$/.test(parsed.hostname))throw Error('presenter_first_frame_master_host_untrusted');const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30_000)});if(!response.ok||Number(response.headers.get('content-length')||0)>15*1024*1024)throw Error('presenter_first_frame_master_unavailable');const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>15*1024*1024)throw Error('presenter_first_frame_master_too_large');return validImage(bytes,response.headers.get('content-type')||'');}
  throw Error('presenter_first_frame_master_missing');
}

/** Real static supplier bridge. It creates one combined person-removal +
 * authorised-person composite, then independently pays Qwen to review the
 * source, identity reference and generated candidate. */
export function createPresenterFirstFrameStaticExecutor(store:DataStore,options:{root?:string;generator?:SeedreamFirstFrameGenerator;inspect?:typeof inspectStoryboardAigcFramesWithQwen;now?:()=>Date;assertProviderBinding?:(route:{stage:string;provider:string;model:string;accountRef:string})=>Promise<void>;loadReferenceFrame?:(tenantId:string,url:string)=>Promise<ImageBytes>;loadPresenterMaster?:(tenantId:string,presenter:StoredPresenter)=>Promise<ImageBytes>}={}):PresenterFirstFrameStaticExecutor{
 return{async prepare(input){
  const frameIntent=intent(input,input.frameOperationId),qaIntent=intent(input,input.qaOperationId);
  if(frameIntent.provider!=='seedream'||qaIntent.provider!=='qwen')throw Error('presenter_first_frame_provider_route_changed');
  const assertBinding=options.assertProviderBinding||createProductionBudgetRouteReaders().assertProviderBinding;await assertBinding({...frameIntent,stage:'first_frame'});await assertBinding({...qaIntent,stage:'first_frame_qa'});
  const selected=input.group.compositions[0]!,source=await (options.loadReferenceFrame||((tenantId,url)=>loadReferenceFrame(store,tenantId,url)))(input.scope.tenantId,selected.referenceFirstFrameUrl),person=await (options.loadPresenterMaster||loadPresenterMaster)(input.scope.tenantId,input.presenter);
  const references:FirstFrameReference[]=[{role:'source_composition',...source},{role:'authorized_presenter',...person}];
  const generator=options.generator||new SeedreamFirstFrameGenerator({model:frameIntent.model});
  const request:FirstFrameRequest={referenceMode:'presenter_replace',tenantId:input.scope.tenantId,videoId:input.scope.taskId,compositionId:input.group.groupId,presenterVersion:`${input.group.presenterAssetId}:${Number(input.presenter.assetVersion)}`,ratio:'9:16',prompt:`严格保持图一的背景、机位、景别、构图、光线和物体位置。移除图一原人物，只把图二已授权人物自然合成到原人物位置；保持图二人物身份、脸型与五官。不得改变背景，不得新增文字、Logo、水印、产品或道具。参考背景：${selected.background}；景别：${selected.framing}；机位：${selected.camera}；构图：${selected.composition}。`,references,idempotencyKey:''};
  request.idempotencyKey=firstFrameInputFingerprint(request,'seedream',frameIntent.model);
  let frameBoundary=false;const paidGenerator=options.generator||new SeedreamFirstFrameGenerator({model:frameIntent.model,beforeSubmit:async body=>{frameBoundary=true;const {maximumUnits,...binding}=frameIntent;await input.paidStatic.permit.beforeSubmit({...binding,actualUnits:{inputImages:Array.isArray(body.image)?body.image.length:0,outputImages:1}});}});
  if(options.generator){const {maximumUnits,...binding}=frameIntent;await input.paidStatic.permit.beforeSubmit({...binding,actualUnits:{inputImages:2,outputImages:1}});frameBoundary=true;}
  const generated=await paidGenerator.generate(request);if(!frameBoundary)throw Error('presenter_first_frame_paid_boundary_missing');
  const frameReceipt=`seedream:${generated.providerRequestId}:${hash(generated.bytes)}`;await input.paidStatic.permit.markOutcome(input.frameOperationId,'completed',frameReceipt);
  const out=await validImage(generated.bytes,generated.mimeType),label='候选首帧';let providerReceipt:unknown=null,qaBoundary=false;
  const inspect=options.inspect||inspectStoryboardAigcFramesWithQwen;
  const evaluation=await evaluateStoryboardFirstFrameQuality({sceneType:'general',hasProduct:false,hasNamedPerson:true,hasEnvironmentReference:true,hasContact:false,hasAction:false,candidateLabels:[label],referenceLabels:['原分镜背景与构图','已授权人物母版'],applyReplicationAutomation:false,
   inspectTechnical:()=>inspectStoryboardTechnicalFrames('first_frame',[{bytes:out.bytes,timeLabel:label}]),inspectVisual:()=>inspect({model:qaIntent.model,boundedPaidQa:true,paidSubmission:async body=>{const {maximumUnits,...binding}=qaIntent;qaBoundary=true;await input.paidStatic.permit.beforeSubmit({...binding,actualUnits:{inputTokens:await measureQwenRequestInputUpperBound(body),outputTokens:Number(body.max_tokens)}});},onReceipt:value=>{providerReceipt=value;},phase:'first_frame',sceneType:'general',frames:[{base64:out.bytes.toString('base64'),mimeType:out.mimeType,timeLabel:label}],personReferences:[{base64:person.bytes.toString('base64'),mimeType:person.mimeType,timeLabel:'已授权人物母版'}],environmentReferences:[{base64:source.bytes.toString('base64'),mimeType:source.mimeType,timeLabel:'原分镜背景与构图'}],storyboard:request.prompt,productInfo:'无产品身份要求；人物身份以已授权人物母版为准，背景、机位和构图以原分镜为准。'})});
  if(!qaBoundary||!providerReceipt)throw Error('presenter_first_frame_qa_receipt_missing');
  const report=evaluation.firstFrameQuality,reportHash=hash(JSON.stringify({evaluation,providerReceipt}));const qwenId=String((providerReceipt as Record<string,unknown>).id||'').trim();if(!qwenId)throw Error('presenter_first_frame_qwen_request_id_missing');
  const qaReceipt=`qwen:${qwenId}:${reportHash}`;await input.paidStatic.permit.markOutcome(input.qaOperationId,'completed',qaReceipt);
  const relative=tenantAssetRelativePath(input.scope.tenantId,`presenter-first-frames/${input.scope.runId}-${input.group.groupId}-${out.sha256.slice(0,16)}.${out.mimeType==='image/png'?'png':out.mimeType==='image/webp'?'webp':'jpg'}`),file=path.join(options.root||MEDIA_ROOT,relative);await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await fs.writeFile(file,out.bytes,{mode:0o600});await fs.writeFile(`${file}.qa.json`,JSON.stringify({evaluation,providerReceipt},null,2),{mode:0o600});
  return{referenceCompositionHashes:input.group.compositions.map(value=>compositionHash(value)),backgroundPlateSha256:source.sha256,personRemovalEvidence:{receiptRef:frameReceipt,sourceSha256:source.sha256,outputSha256:out.sha256},compositeFirstFrameSha256:out.sha256,compositeFirstFrameUrl:`/media/${relative}`,qa:{passed:Boolean(evaluation.firstFrameQualityState==='evaluated'&&report?.automatedPassed),receiptRef:qaReceipt,reportHash},createdAt:(options.now?.()||new Date()).toISOString()};
 }};
}

/** Validate the durable production inputs at the real worker boundary. The
 * repository currently lacks a ledger-authorized person-removal/composite
 * operation for this preflight hook. Calling an image model here would happen
 * before the task budget is frozen, so the adapter fails at that exact gap. */
export function createPresenterFirstFrameProductionRuntime(store: DataStore, executor?:PresenterFirstFrameStaticExecutor): Pick<SocialContentAutoProductionRuntime, 'preparePresenterMotherFirstFrames'> {
  return { async preparePresenterMotherFirstFrames(input) {
    if (!input.groups.length) return [];
    if (new Set(input.groups.map(group => group.groupId)).size !== input.groups.length) throw new Error('presenter_first_frame_group_scope_ambiguous');
    const defaults = await store.list<{payload?: {defaultPresenterId?: string; presenters?: StoredPresenter[]}}>('studio_production_defaults', { where: { tenant_id: input.scope.tenantId }, perPage: 2 });
    if (defaults.totalItems !== 1 || defaults.items.length !== 1) throw new Error('presenter_first_frame_default_presenter_store_not_unique');
    const payload = defaults.items[0]!.payload || {}, defaultPresenterId = String(payload.defaultPresenterId || '').trim();
    if (!defaultPresenterId) throw new Error('presenter_first_frame_default_presenter_missing');
    const presenters=new Map<string,StoredPresenter>();
    for (const group of input.groups) {
      if (group.presenterAssetId !== defaultPresenterId) throw new Error(`presenter_first_frame_default_presenter_changed:${group.groupId}`);
      if (!group.compositions.length || group.compositions.some(value => !value.referenceShotId.trim() || !value.referenceFirstFrameUrl.trim() || !value.background.trim() || !value.framing.trim() || !value.camera.trim() || !value.composition.trim())) throw new Error(`presenter_first_frame_reference_composition_incomplete:${group.groupId}`);
      const matches = (payload.presenters || []).filter(item => String(item.id || '').trim() === group.presenterAssetId);
      if (matches.length !== 1) throw new Error(`presenter_first_frame_presenter_asset_not_unique:${group.groupId}`);
      const presenter = matches[0]!, version = Number(presenter.assetVersion);
      const avatarId = String(presenter.toolMappings?.heygen?.avatarId || presenter.avatarId || '').trim(), voiceId = String(presenter.toolMappings?.heygen?.voiceId || presenter.voiceId || '').trim();
      const rights = validatePresenterRightsEvidence(presenter.rightsEvidence, { provider: 'heygen', uses: ['digital_presenter', 'voice_synthesis'] });
      const arkRights=validatePresenterRightsEvidence(presenter.rightsEvidence,{provider:'volcengine_ark',uses:['person_replacement']});
      const qwenRights=validatePresenterRightsEvidence(presenter.rightsEvidence,{provider:'dashscope',uses:['quality_inspection']});
      if (presenter.authorized !== true || !Number.isSafeInteger(version) || version < 1 || !avatarId || !voiceId || !rights.ok || !arkRights.ok || !qwenRights.ok) throw new Error(`presenter_first_frame_default_presenter_not_authorized:${group.groupId}`);
      presenters.set(group.groupId,presenter);
    }
    if(!executor)throw new Error('presenter_first_frame_paid_static_executor_missing');
    const approvals:PresenterFirstFrameApprovalContract[]=[];
    for(const group of input.groups){
      const requirements=input.paidStatic.requirements.filter(r=>r.presenterGroupId===group.groupId&&['first_frame','first_frame_qa'].includes(r.stage));
      if(requirements.length!==2)throw Error(`presenter_first_frame_paid_requirements_missing:${group.groupId}`);
      // Route is part of the planner's operation hash, therefore bind by the
      // unique stage/group pair here and leave the permit to verify every
      // provider/model/account/input hash at submission time.
      const frame=input.paidStatic.intents.filter(i=>i.stage==='first_frame'&&i.shotId===group.groupId),qa=input.paidStatic.intents.filter(i=>i.stage==='first_frame_qa'&&i.shotId===group.groupId);
      if(frame.length!==1||qa.length!==1)throw Error(`presenter_first_frame_paid_intents_ambiguous:${group.groupId}`);
      const result=await executor.prepare({...input,group,presenter:presenters.get(group.groupId)!,frameOperationId:frame[0]!.operationId,qaOperationId:qa[0]!.operationId});
      const [frameReceipt,qaReceipt]=await Promise.all([input.paidStatic.permit.assertRecovery(frame[0]!.operationId),input.paidStatic.permit.assertRecovery(qa[0]!.operationId)]);
      if(frameReceipt.status!=='completed'||qaReceipt.status!=='completed'||frameReceipt.receiptRef!==result.personRemovalEvidence.receiptRef||qaReceipt.receiptRef!==result.qa.receiptRef)throw Error(`presenter_first_frame_paid_receipt_unverified:${group.groupId}`);
      if(!result.qa.passed)throw Error(`presenter_first_frame_qa_failed:${group.groupId}`);
      const rights=presenters.get(group.groupId)!.rightsEvidence as {authorizationRef?:string;consentRef?:string};
      approvals.push(await createPresenterFirstFrameApproval(store,{...input.scope,groupId:group.groupId,presenterGroupContractHash:group.presenterGroupContractHash,referenceCompositionHashes:result.referenceCompositionHashes,backgroundPlateSha256:result.backgroundPlateSha256,personRemovalEvidence:result.personRemovalEvidence,presenter:{assetId:group.presenterAssetId,assetVersion:Number(presenters.get(group.groupId)!.assetVersion),authorizationRef:String(rights.authorizationRef||''),consentRef:String(rights.consentRef||''),providerId:'heygen',providerPresenterId:String(presenters.get(group.groupId)!.toolMappings?.heygen?.avatarId||presenters.get(group.groupId)!.avatarId||''),providerVoiceId:String(presenters.get(group.groupId)!.toolMappings?.heygen?.voiceId||presenters.get(group.groupId)!.voiceId||'')},compositeFirstFrameSha256:result.compositeFirstFrameSha256,compositeFirstFrameUrl:result.compositeFirstFrameUrl,qa:result.qa,createdAt:result.createdAt}));
    }
    return approvals;
  } };
}
