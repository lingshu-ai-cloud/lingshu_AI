import { createHash, randomUUID } from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path'; import { execFile } from 'node:child_process'; import { promisify } from 'node:util'; import ffmpegStatic from 'ffmpeg-static';
import { generateSeedanceSentenceVideo } from './seedanceImageVideo.js'; import { runSentenceReplicationPipeline } from './sentenceReplicationPipeline.js';
import { readLocalMaterials, saveLocalMaterials, type MaterialRecord } from './materialLibrary.js'; import { tenantAssetDir, tenantAssetRelativePath } from './assetAccess.js'; import { materialAssetContentType, materialAssetObjectKey } from '../storage/materialAssets.js'; import { objectStorageDownload, objectStorageHead, objectStorageSignedGetUrl, objectStorageSupplierDeliveryReady, objectStorageUpload } from '../storage/objectStorage.js';
import { sentenceReplicationReadiness } from '../runtime/readiness.js';
import type { PresenterAsset, ShotProduction } from '../../src/lib/shotProduction.js'; import type { DigitalHumanReferenceCue, SentenceCueQuality, SentenceReplicationResult } from '../../src/lib/digitalHumanPlan.js';
import { acceptSeedancePortrait } from './presenterAssetAcceptance.js';
import { SeedreamFirstFrameGenerator } from './seedreamFirstFrameGenerator.js';
import { firstFrameInputFingerprint, type FirstFrameReference } from './firstFrameGenerator.js';
import { produceFirstFrame } from './firstFrameProduction.js';
import { clusterSourceFirstFrameMaterialId, planPersonShotClusters } from '../../src/lib/personShotClustering.js';
import { checkAvatarMedia } from './avatarMediaCheck.js';
import { inspectPersonReplacementPair } from './personReplacementMediaQuality.js';
import { inspectPersonReplacementVisualPair } from './personReplacementVisualQuality.js';
import { sentenceCueQualityFromEvidence } from './sentenceCueQuality.js';
import { inspectSentenceSemanticQuality } from './sentenceSemanticQuality.js';
import { inspectSentenceLipSyncQuality } from './sentenceLipSyncQuality.js';
import { validatePresenterRightsEvidence } from './presenterAssetTrust.js';

const MEDIA_ROOT = path.resolve(process.cwd(), 'data/media');
const run = promisify(execFile);
async function bytesFor(material: MaterialRecord, tenantId: string): Promise<{ bytes: Buffer; mimeType: string }> { if (material.scope !== 'shared' && String(material.tenantId || material.tenant_id || '') !== tenantId) throw new Error('逐句素材不属于当前企业'); if (material.file) { const file = path.resolve(MEDIA_ROOT, String(material.file)); if (file.startsWith(path.resolve(MEDIA_ROOT)) && fs.existsSync(file)) return { bytes: fs.readFileSync(file), mimeType: materialAssetContentType(file) }; } if (material.objectKey) { const object = await objectStorageDownload(String(material.objectKey)); if (object) return { bytes: object.buf, mimeType: object.contentType }; } throw new Error(`素材 ${material.id} 没有可读取文件`); }
function stableId(prefix: string, requestId: string, cueId = '') { return `${prefix}-${createHash('sha256').update(`${requestId}:${cueId}`).digest('hex').slice(0,24)}`; }
function persistMaterial(material: MaterialRecord) { const current = readLocalMaterials(); saveLocalMaterials([...current.filter(item => item.id !== material.id), material]); }
export async function runProductionSentenceReplication(input: { tenantId: string; projectId: string; assemblyId: string; shotId: string; fingerprint: string; shot: ShotProduction; presenter: PresenterAsset; cues: DigitalHumanReferenceCue[]; requestId: string; reuseCueMaterialIds?: Record<string,string>; reuseCueQuality?: SentenceCueQuality[]; onProviderTaskSubmitted?: (cueId:string,taskId:string)=>Promise<void> }): Promise<SentenceReplicationResult> {
  const readiness = sentenceReplicationReadiness();
  if (!readiness.ready) throw new Error(readiness.reason);
  if (!objectStorageSupplierDeliveryReady()) throw new Error('本地系统存储已启用，但 Seedance 无法访问 localhost；真实出片需生产 COS 签名地址或显式配置 HTTPS 开发地址');
  const materials = readLocalMaterials(); const byId = new Map(materials.map(item => [String(item.id), item])); const presenterIds = [...new Set([...(input.presenter.toolMappings?.seedance?.referenceMaterialIds || []), ...(input.presenter.toolMappings?.sd?.referenceMaterialIds || []), ...(input.presenter.toolMappings?.runway?.referenceMaterialIds || []), ...(input.presenter.referenceMaterialIds || [])])];
  if (!presenterIds.length) throw new Error('企业人物缺少可用于首帧重建的参考图片');
  let presenterReference: FirstFrameReference | null = null; for (const id of presenterIds) { const material = byId.get(id); if (!material || material.type !== 'image') continue;
    // Fail closed before any portrait bytes are read or sent to an external model.
    acceptSeedancePortrait({ tenantId: input.tenantId, presenter: input.presenter, material });
    const loaded = await bytesFor(material,input.tenantId); presenterReference = { role: 'authorized_presenter', bytes: loaded.bytes,
      mimeType: /png/i.test(loaded.mimeType) ? 'image/png' : /webp/i.test(loaded.mimeType) ? 'image/webp' : 'image/jpeg',
      sha256: createHash('sha256').update(loaded.bytes).digest('hex') }; break; }
  if (!presenterReference) throw new Error('企业人物没有可读取的参考图片；视频参考不能代替首帧身份图');
  const maxFrames = Math.max(1, Number(process.env.DIGITAL_HUMAN_MAX_FIRST_FRAMES_PER_VIDEO) || 3);
  const clusterPlan = planPersonShotClusters(input.cues,maxFrames); if(clusterPlan.state!=='ready') throw new Error(clusterPlan.blockers.join('；'));
  const clusterByCue = new Map(clusterPlan.clusters.flatMap(cluster=>cluster.cueIds.map(cueId=>[cueId,cluster] as const)));
  const work = path.join(tenantAssetDir(MEDIA_ROOT,input.tenantId),`.sentence-${createHash('sha256').update(input.requestId).digest('hex').slice(0,16)}`); fs.mkdirSync(work,{recursive:true}); const providerTaskIds: string[] = []; const cueQuality=new Map((input.reuseCueQuality||[]).map(item=>[item.cueId,item]));
  const referenceMaterial=byId.get(String(input.shot.digitalHuman?.reference?.materialId||'')); if(!referenceMaterial||referenceMaterial.type!=='video')throw new Error('逐句质检缺少可读取的参考视频'); const referenceBytes=await bytesFor(referenceMaterial,input.tenantId); const referencePath=path.join(work,'reference-video'); fs.writeFileSync(referencePath,referenceBytes.bytes,{mode:0o600});
  const sourceSegmentFor=async(cue:DigitalHumanReferenceCue)=>{const filePath=path.join(work,`reference-${createHash('sha256').update(cue.id).digest('hex').slice(0,12)}.mp4`); await run(String(ffmpegStatic||''),['-hide_banner','-loglevel','error','-nostdin','-ss',String(cue.start),'-i',referencePath,'-t',String(cue.end-cue.start),'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','-y',filePath],{timeout:120_000}); return filePath;};
  const firstFrameGenerator = new SeedreamFirstFrameGenerator(); const frameByComposition = new Map<string, Promise<{ materialId: string; filePath: string; url: string }>>();
  try { const result = await runSentenceReplicationPipeline({ cues: input.cues, outputPath:path.join(work,'joined.mp4'), ffmpegPath:String(ffmpegStatic || ''),
      reuseCompletedClip: async cue=>{ const materialId=String(input.reuseCueMaterialIds?.[cue.id]||''); if(!materialId) return null; const material=byId.get(materialId); if(!material || material.type!=='video') throw new Error(`已通过镜头 ${cue.id} 的复用素材不存在`); const loaded=await bytesFor(material,input.tenantId); const filePath=path.join(work,`reuse-${createHash('sha256').update(`${cue.id}:${materialId}`).digest('hex').slice(0,16)}.mp4`); fs.writeFileSync(filePath,loaded.bytes,{mode:0o600}); return {materialId,filePath,url:String(material.url||'')}; },
      createTargetFrame: async cue => { const cluster=clusterByCue.get(cue.id); if(!cluster) throw new Error(`人物镜头 ${cue.id} 缺少构图簇`); const compositionId=cluster.fingerprint; const existing = frameByComposition.get(compositionId); if (existing) return existing;
        const task = (async () => { const sourceMaterialId=clusterSourceFirstFrameMaterialId(cluster,input.cues); const source = byId.get(sourceMaterialId); if (!source) throw new Error(`构图簇 ${cluster.id} 缺少源首帧素材`); const loaded = await bytesFor(source,input.tenantId);
          const sourceReference: FirstFrameReference = { role: 'source_composition', bytes: loaded.bytes,
            mimeType: /png/i.test(loaded.mimeType) ? 'image/png' : /webp/i.test(loaded.mimeType) ? 'image/webp' : 'image/jpeg', sha256:createHash('sha256').update(loaded.bytes).digest('hex') };
          const request = { tenantId:input.tenantId, videoId:`${input.projectId}:${input.assemblyId}`, compositionId, presenterVersion:`${input.presenter.id}:${input.presenter.assetVersion || 1}`,
            prompt:'保持图一的机位、景别、姿态意图、产品位置、背景几何与光线，仅用图二的已授权企业人物替换图一人物。保持自然、写实、身份稳定；不要添加字幕、界面、徽标或水印。',
            ratio:'9:16' as const, references:[sourceReference,presenterReference!], idempotencyKey:'' };
          request.idempotencyKey=firstFrameInputFingerprint(request,firstFrameGenerator.provider,firstFrameGenerator.model);
          const generated=await produceFirstFrame(request,firstFrameGenerator); const stored=await objectStorageDownload(generated.objectKey); if(!stored?.buf.length) throw new Error('目标人物首帧入库后无法读取');
          const id=`target-frame-${generated.operationId.slice(0,24)}`; const extension=stored.contentType.includes('png')?'png':stored.contentType.includes('webp')?'webp':'jpg'; const filename=`${id}.${extension}`; const filePath=path.join(work,filename); fs.writeFileSync(filePath,stored.buf,{mode:0o600}); const head=await objectStorageHead(generated.objectKey); if(!head?.etag) throw new Error('目标人物首帧上传后缺少对象版本');
          persistMaterial({id,name:`目标人物首帧 · ${compositionId}`.slice(0,100),folder:'presenter',type:'image',duration:0,size:`${Math.ceil(stored.buf.length/1024)} KB`,file:'',url:'',objectKey:generated.objectKey,objectEtag:head.etag,contentSha256:generated.contentSha256,scope:'own',tenantId:input.tenantId,sourceType:'digital-human-target-first-frame',providerRequestId:generated.providerRequestId,providerModel:generated.model,estimatedCostCny:generated.estimatedCostCny,createdAt:new Date().toISOString()});
          return {materialId:id,filePath,url:await objectStorageSignedGetUrl(generated.objectKey,900)}; })(); frameByComposition.set(compositionId,task); return task; },
      createNonPersonClip: async cue => { const material=byId.get(String(cue.nonPersonMaterialId||'')); if(!material || material.type!=='video') throw new Error(`非人物镜头 ${cue.id} 的替换视频不存在或不可用`); const loaded=await bytesFor(material,input.tenantId); const id=stableId('non-person-clip',input.requestId,cue.id); const filePath=path.join(work,`${id}.mp4`); fs.writeFileSync(filePath,loaded.bytes,{mode:0o600}); return {materialId:String(material.id),filePath,url:String(material.url||'')}; },
      createSentenceVideo: async (cue,frame) => {
        const generated=await generateSeedanceSentenceVideo({apiKey:process.env.SEEDANCE_API_KEY||'',model:process.env.SEEDANCE_MODEL||'doubao-seedance-2-0-fast-260128',baseUrl:process.env.SEEDANCE_BASE_URL,imageUrl:frame.url||'',duration:cue.end-cue.start,ratio:'9:16',prompt:`Animate the supplied enterprise-presenter first frame as one continuous B2B talking-head shot. The presenter naturally speaks in Chinese: ${cue.targetText || input.shot.narration}. Preserve identity, composition, product and background. Natural lip sync and restrained gestures. No captions, logos, UI or watermark.`,onSubmitted:async taskId=>{providerTaskIds.push(taskId);await input.onProviderTaskSubmitted?.(cue.id,taskId);}});
        const response=await fetch(generated.videoUrl,{signal:AbortSignal.timeout(90_000)}); if(!response.ok) throw new Error(`逐句视频下载失败：HTTP ${response.status}`);
        const bytes=Buffer.from(await response.arrayBuffer()); const id=stableId('sentence-video',input.requestId,cue.id); const filePath=path.join(work,`${id}.mp4`); fs.writeFileSync(filePath,bytes);
        const media=await checkAvatarMedia(filePath,{ratio:'9:16',duration:cue.end-cue.start,transparent:false}); const sourcePath=await sourceSegmentFor(cue);
        let technical=null; let technicalError=''; let visual=null; let visualError=''; let semantic=null; let semanticError=''; let lipSync=null; let lipSyncError='';
        try{technical=await inspectPersonReplacementPair(sourcePath,filePath);}catch(error){technicalError=error instanceof Error?error.message:String(error);}
        if(process.env.DIGITAL_HUMAN_VISUAL_QA_PYTHON){try{visual=await inspectPersonReplacementVisualPair(sourcePath,filePath);}catch(error){visualError=error instanceof Error?error.message:String(error);}}
        if(process.env.DIGITAL_HUMAN_SEMANTIC_QA_ENABLED==='true'){
          const semanticRights=validatePresenterRightsEvidence(input.presenter.rightsEvidence,{provider:'dashscope',uses:['quality_inspection']});
          if(!semanticRights.ok)semanticError=`未授权阿里云百炼进行人物质量检测：${semanticRights.reasons.join(',')}`;
          else try{semantic=await inspectSentenceSemanticQuality({presenterBytes:Buffer.from(presenterReference!.bytes),presenterMimeType:presenterReference!.mimeType,sourceVideoPath:sourcePath,candidateVideoPath:filePath,targetText:cue.targetText||input.shot.narration});}catch(error){semanticError=error instanceof Error?error.message:String(error);}
        }
        if(process.env.DIGITAL_HUMAN_SYNCNET_QA_ENABLED==='true'){
          try{lipSync=await inspectSentenceLipSyncQuality(filePath,{workDir:path.join(work,`syncnet-${createHash('sha256').update(cue.id).digest('hex').slice(0,12)}`)});}catch(error){lipSyncError=error instanceof Error?error.message:String(error);}
        }
        cueQuality.set(cue.id,sentenceCueQualityFromEvidence({cueId:cue.id,mediaEvidence:`${media.width}x${media.height} · ${media.duration.toFixed(3)}s · audio=${media.hasAudio}`,technical,technicalError,visual,visualError,semantic,semanticError,lipSync,lipSyncError}));
        const relative=tenantAssetRelativePath(input.tenantId,`${id}.mp4`); const stored=path.join(MEDIA_ROOT,relative); fs.mkdirSync(path.dirname(stored),{recursive:true}); fs.copyFileSync(filePath,stored);
        persistMaterial({id,name:`逐句数字人视频 · ${cue.targetText || cue.originalText}`.slice(0,100),folder:'presenter',type:'video',duration:cue.end-cue.start,size:`${Math.ceil(bytes.length/1024)} KB`,file:relative,url:`/media/${relative}`,scope:'own',tenantId:input.tenantId,sourceType:'digital-human-sentence-video',providerTaskId:generated.taskId,contentSha256:createHash('sha256').update(bytes).digest('hex'),createdAt:new Date().toISOString()});
        return {materialId:id,filePath,url:`/media/${relative}`};
      } });
    for(const cue of result.cues.filter(item=>item.personShot===false)) cueQuality.set(cue.id,{cueId:cue.id,kind:'non_person_material',state:'accepted',checks:[{key:'media',status:'passed',evidence:`tenant material:${cue.nonPersonMaterialId}`},{key:'reuse_risk',status:'passed',evidence:'使用已选本企业素材，不复用未授权爆款原片'},...(['identity','motion','product_brand_text','background','audio_sync'] as const).map(key=>({key,status:'passed' as const,evidence:'非人物素材沿用企业素材验收'}))]});
    const finalBytes=fs.readFileSync(result.outputPath); const id=stableId('viral-replication',input.requestId); const filename=`${id}.mp4`; const relative=tenantAssetRelativePath(input.tenantId,filename); const finalPath=path.join(MEDIA_ROOT,relative); fs.mkdirSync(path.dirname(finalPath),{recursive:true}); fs.copyFileSync(result.outputPath,finalPath); const key=materialAssetObjectKey(input.tenantId,filename); await objectStorageUpload({key,body:finalBytes,contentType:'video/mp4'}); const head=await objectStorageHead(key); if(!head?.etag) throw new Error('拼接候选上传后缺少对象版本'); const contentSha256=createHash('sha256').update(finalBytes).digest('hex'); const final:MaterialRecord={id,name:'爆款逐句复刻 · 数字人候选',folder:'presenter',type:'video',duration:result.cues.reduce((sum,cue)=>sum+cue.end-cue.start,0),size:`${Math.ceil(finalBytes.length/1024)} KB`,file:relative,url:`/media/${relative}`,objectKey:key,objectEtag:head.etag,scope:'own',tenantId:input.tenantId,sourceType:'viral-sentence-replication',contentSha256,providerTaskIds,createdAt:new Date().toISOString()}; persistMaterial(final); const quality=[...cueQuality.values()]; return {cues:result.cues,materialId:id,candidateUrl:final.url,providerTaskIds,candidateOutput:{materialId:id,objectKey:key,contentSha256,objectEtag:head.etag},cueQuality:quality,failedCueIds:quality.filter(item=>item.state==='failed').map(item=>item.cueId),state:'completed'};
  } finally { fs.rmSync(work,{recursive:true,force:true}); }
}
