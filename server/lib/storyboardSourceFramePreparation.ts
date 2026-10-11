import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {evaluateStoryboardFirstFrameQuality} from './storyboardFirstFrameQualityEvaluation.js';
import {inspectStoryboardTechnicalFrames} from './storyboardAigcQuality.js';
import {inspectStoryboardAigcFramesWithQwen} from '../agents/qwen.js';
/** Free local source-image preparation preserves the source background as well as
 * packaging. It does not claim a transparent cutout or invented tabletop contact. */
export async function prepareOwnedStoryboardSourceFrame(input:{bytes:Buffer;expectedSha256:string;description:string;productInfo:string;visualQa:boolean;authorizeVisualQa?:()=>Promise<void>}) {
 const sha=createHash('sha256').update(input.bytes).digest('hex');
 if(sha!==input.expectedSha256)throw Error('storyboard_owned_source_hash_changed');
 const bytes=await sharp(input.bytes).resize(720,1280,{fit:'contain',background:'#f4f4f4'}).png().toBuffer();
 const technical=await inspectStoryboardTechnicalFrames('first_frame',[{bytes,timeLabel:'候选首帧'}]);
 if(!input.visualQa)return{bytes,sourceSha256:sha,outputSha256:createHash('sha256').update(bytes).digest('hex'),technical,quality:null,canProceedToVideo:false};
 if(!input.authorizeVisualQa)throw Error('source_frame_QA_budget_required');
 await input.authorizeVisualQa();
 const quality=await evaluateStoryboardFirstFrameQuality({sceneType:'product',hasProduct:true,hasNamedPerson:false,hasContact:false,hasAction:true,candidateLabels:['候选首帧'],referenceLabels:['企业产品原图'],applyReplicationAutomation:true,
 inspectTechnical:async()=>technical,
 inspectVisual:()=>inspectStoryboardAigcFramesWithQwen({phase:'first_frame',sceneType:'product',frames:[{base64:bytes.toString('base64'),mimeType:'image/png',timeLabel:'候选首帧'}],productReferences:[{base64:input.bytes.toString('base64'),mimeType:'image/png',timeLabel:'企业产品原图'}],storyboard:input.description,productInfo:input.productInfo})});
 return{bytes,sourceSha256:sha,outputSha256:createHash('sha256').update(bytes).digest('hex'),technical,quality,canProceedToVideo:quality.canProceedToVideo};
}
