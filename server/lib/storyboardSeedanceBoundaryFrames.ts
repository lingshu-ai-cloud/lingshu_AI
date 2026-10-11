import {createHash} from 'node:crypto';
/** Server-side request construction only: no upload, reservation or provider call. */
export function buildSeedanceBoundaryFrames(input:{tenantId:string;taskId:string;version:number;runId:string;projectId:string;shotId:string;projectShotFingerprint:string;firstFrame:Buffer;lastFrame:Buffer;prompt:string;transform:{kind:'center_crop_scale';scale:1.02;sourceSha256:string;outputSha256:string;width:720;height:1280};model:string;baseUrl:string}) {
 const hash=(x:Buffer|string)=>createHash('sha256').update(x).digest('hex');
 const firstSha=hash(input.firstFrame),lastSha=hash(input.lastFrame);
 if(!input.tenantId||!input.taskId||!input.runId||!input.projectId||input.shotId!=='S04'||!Number.isSafeInteger(input.version)||input.version<1||!/^[a-f0-9]{64}$/.test(input.projectShotFingerprint)||!input.prompt.trim())throw Error('boundary_frames_scope_invalid');
 const t=input.transform;if(t.kind!=='center_crop_scale'||t.scale!==1.02||t.width!==720||t.height!==1280||t.sourceSha256!==firstSha||t.outputSha256!==lastSha||!input.firstFrame.length||!input.lastFrame.length)throw Error('boundary_frames_transform_evidence_invalid');
 if(input.model!=='doubao-seedance-2-0-fast-260128'||input.baseUrl!=='https://ark.cn-beijing.volces.com/api/v3')throw Error('boundary_frames_model_not_verified');
 const image=(b:Buffer)=>{const png=b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=b[0]===255&&b[1]===216&&b[2]===255;if(!png&&!jpeg)throw Error('boundary_frames_image_type_invalid');return`data:image/${png?'png':'jpeg'};base64,${b.toString('base64')}`;};
 const content=[{type:'text',text:input.prompt},{type:'image_url',role:'first_frame',image_url:{url:image(input.firstFrame)}},{type:'image_url',role:'last_frame',image_url:{url:image(input.lastFrame)}}];
 const fingerprintInput={tenantId:input.tenantId,taskId:input.taskId,version:input.version,runId:input.runId,projectId:input.projectId,shotId:input.shotId,projectShotFingerprint:input.projectShotFingerprint,firstFrameSha256:firstSha,lastFrameSha256:lastSha,transform:t,prompt:input.prompt,roles:['first_frame','last_frame'],model:input.model,baseUrl:input.baseUrl,duration:4,resolution:'720p',ratio:'9:16',generateAudio:false};
 return{fingerprint:createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex'),fingerprintInput,request:{model:input.model,baseUrl:input.baseUrl,content,ratio:'9:16',duration:4,resolution:'720p',silent:true}};
}
