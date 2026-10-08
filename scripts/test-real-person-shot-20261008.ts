import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createHash } from 'node:crypto';
const source = path.resolve('../local-preview-1002');
dotenv.config({path:path.join(source,'.env'),quiet:true});
dotenv.config({path:path.join(source,'.env.local'),override:true,quiet:true});
const tunnelLog=path.resolve('data/acceptance/real-shot-replication-20261008/tunnel.log');
if(fs.existsSync(tunnelLog)) {
 const urls=fs.readFileSync(tunnelLog,'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
 if(urls?.length) process.env.LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL=urls.at(-1);
}
const root = path.resolve('data/acceptance/real-shot-replication-20261008');
const reuseCertified=process.argv.includes('--reuse-certified-first-frame');
const stateFile = path.join(root,reuseCertified?'person-shot-certified-reuse-state.json':'person-shot-state.json');
const parse = (v:any)=>typeof v==='string'?JSON.parse(v):v;
const defaults = JSON.parse(fs.readFileSync(path.join(source,'data/local-store/studio_production_defaults.json'),'utf8'));
const tenantId = 'local_tenant_customer_1b2913131e2c46deab66172228c4df0a';
const presenter = parse(defaults.find((d:any)=>d.tenant_id===tenantId).payload).presenters.find((p:any)=>p.id==='presenter-f281e943169413c9b5525072');
const file = `tenants/${tenantId}/reference-videos/trend_videos_192e76d4b21244c4a2922e60672c95f2.mp4`;
const sourceMaterial:any = {id:'trend_videos_192e76d4b21244c4a2922e60672c95f2',type:'video',scope:'own',tenantId,file,usage:'analysis',verifyContentSha256:true,contentSha256:createHash('sha256').update(fs.readFileSync(path.join('data/media',file))).digest('hex')};
const state:any=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{requestId:reuseCertified?'real-motion-replication-opening-20261008-v2-certified-reuse':'real-motion-replication-opening-20261008-v1',providerTasks:{},state:'preparing'};
const save=()=>fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
if(state.state==='completed'){console.log(JSON.stringify({state:state.state,materialId:state.result?.materialId,cueQuality:state.result?.cueQuality}));process.exit(0);}
const {extractSentenceFirstFrames}=await import('../server/lib/sentenceFirstFramePipeline.js');
const {runProductionSentenceReplication}=await import('../server/lib/sentenceReplicationProduction.js');
const {prepareLocalSeedanceMotionGuide}=await import('../server/lib/seedanceMotionGuide.js');
const cue:any={id:'opening-real-person-1',start:0.16,end:5.1,originalText:'Hello, boss! Do you want to customize your own brand of skincare products?',targetText:'Hello, boss! Do you want to customize your own brand of skincare products?',personShot:true,shotIds:['slot-1'],compositionClusterId:'opening-lab-walk-medium',firstFrameSeconds:0.3};
try {
 state.cues=await extractSentenceFirstFrames({tenantId,referenceMaterialId:sourceMaterial.id,sourceMaterial,cues:[cue]});save();
 if(reuseCertified){
  const materials=JSON.parse(fs.readFileSync('data/materials.json','utf8'));
  const target=materials.find((m:any)=>m.id==='target-frame-fd045318316a64ac885bd7ac');
  const sourceFrame=materials.find((m:any)=>m.id===target?.sourceFrameMaterialId);
  if(target?.presenterAssetId!==presenter.id||target.presenterAssetVersion!==presenter.assetVersion||sourceFrame?.sourceMaterialId!==sourceMaterial.id||sourceFrame.sourceTime<0.1||sourceFrame.sourceTime>0.2) throw Error('Existing certified frame does not match presenter version and opening source lineage');
  const {VolcengineArkAssets}=await import('../server/lib/volcengineArkAssets.js');
  const asset=await new VolcengineArkAssets().findImage(presenter.arkCertification.projectName,presenter.arkCertification.groupId,target.seedanceTrustedAsset.uri.replace('asset://',''));
  if(asset?.Status!=='Active')throw Error('Existing opening target frame is no longer Active');
  state.cues=[{...cue,start:sourceFrame.sourceTime,sourceFirstFrame:{time:sourceFrame.sourceTime,materialId:sourceFrame.id},targetFirstFrame:{state:'ready',materialId:target.id}}];
  state.frameReuse={targetMaterialId:target.id,sourceFrameMaterialId:sourceFrame.id,presenterAssetVersion:target.presenterAssetVersion,remoteStatus:asset.Status};save();
 }
 const shot:any={source:'avatar',narration:cue.targetText,digitalHuman:{workflow:'viral_replication',presenterMode:'video_twin',action:'The presenter walks sideways next to a glass laboratory wall, smiles, opens both arms, then introduces the products. Preserve the full-body walk and arm gestures rather than a static talking head.',preserve:'Original camera framing, camera movement, pace, walking direction, body performance and target enterprise identity.',reference:{materialId:sourceMaterial.id,cues:state.cues}}};
 state.state='running';save();
 state.result=await runProductionSentenceReplication({tenantId,projectId:'real-shot-test-20261008',assemblyId:'video-1',shotId:'opening-real-person-1',fingerprint:sourceMaterial.contentSha256,shot,presenter,cues:state.cues,requestId:state.requestId,maxCostCny:15,targetLanguage:'en',sourceMaterial,existingProviderTasks:state.providerTasks,onProviderTaskSubmitted:async(cueId,taskId)=>{state.providerTasks[cueId]=taskId;save();console.log(JSON.stringify({phase:'supplier_submitted',cueId,taskId}));},prepareMotionGuide:async(value)=>prepareLocalSeedanceMotionGuide({tenantId, cueId:value.cue.id,sourceVideoPath:value.sourceVideoPath})});
 state.state='completed';save();console.log(JSON.stringify({phase:'completed',materialId:state.result.materialId,providerTaskIds:state.result.providerTaskIds,cueQuality:state.result.cueQuality}));
}catch(e){state.state=Object.keys(state.providerTasks).length?'uncertain':'failed';state.error=(e as Error).message.replace(/assetToken=[^\s"\\]+/g,'assetToken=[redacted]');save();console.log(JSON.stringify({phase:state.state,error:state.error,providerTasks:state.providerTasks}));process.exitCode=1;}
