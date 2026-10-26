import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import ffmpegStatic from 'ffmpeg-static';
import {auditPlainAssCueBinding} from './socialCaptionAssCueAudit.js';
import {proveSimpleCaptionPixels,type SimpleCaptionPixelProof} from './socialCaptionSimplePixelProof.js';
import {socialCaptionRendererFonts} from './socialCaptionRendererFonts.js';

export interface CaptionMaskFrameAudit {
  status:'observed_mask_delta'|'unknown';
  plainCueBinding?:{status:'matched'|'mismatch'|'unknown';reason:string};
  simplePixelProof?:SimpleCaptionPixelProof;
  finalSha256:string;baselineSha256:string;assSha256:string;
  frameCount:number;activeFrameCount:number;missingFrameIndexes:number[];
  reason:string;
}
/** A parsed plain ASS event contradicting its frozen cue is a measured defect.
 * Unknown pixel observations are not proof of either success or failure. */
export function hasKnownCaptionMaskFailure(value:unknown):boolean {
  if(!value||typeof value!=='object')return false;
  const audit=value as Partial<CaptionMaskFrameAudit>;
  return audit.plainCueBinding?.status==='mismatch';
}
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function fileDigest(file:string):Promise<string>{const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
const escapeFilterPath=(value:string)=>value.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/:/g,'\\:').replace(/,/g,'\\,');
const unknown=(finalSha256:string,baselineSha256:string,assSha256:string,reason:string,frameCount=0,activeFrameCount=0,missingFrameIndexes:number[]=[]):CaptionMaskFrameAudit=>({status:'unknown',finalSha256,baselineSha256,assSha256,frameCount,activeFrameCount,missingFrameIndexes,reason});
function frames(source:string):Array<{index:number;pts:number;timeBase:string}>|null{
 const base=source.match(/^#tb 0: (\d+\/\d+)$/m)?.[1];
 if(!base)return null;
 const rows=source.split(/\r?\n/).filter(line=>/^0,/.test(line)).map(line=>line.split(',').map(part=>part.trim()));
 if(!rows.length||rows.some((row,index)=>row.length<6||Number(row[1])!==index||!/^\d+$/.test(row[2]??'')))return null;
 return rows.map((row,index)=>({index,pts:Number(row[2]),timeBase:base}));
}
function stats(source:string):Array<{index:number;seconds:number;average:number}>|null{
 const rows=[...source.matchAll(/frame:(\d+)\s+pts:\d+\s+pts_time:([\d.]+)[^\n]*\n(?:[^\n]*\n)*?lavfi\.signalstats\.YAVG=([\d.]+)/g)]
  .map(match=>({index:Number(match[1]),seconds:Number(match[2]),average:Number(match[3])}));
 return rows.length&&rows.every((row,index)=>row.index===index&&Number.isFinite(row.average))?rows:null;
}
/** A bounded spatial check catches missing glyph regions hidden by a whole-frame average. */
async function spatiallyMissingFrames(input:{finalPath:string;baselinePath:string;assPath:string;durationSeconds:number;width:number;height:number;fps:number;frameCount:number}):Promise<number[]|null>{
 const {width,height,frameCount}=input,stride=width*3,frameBytes=stride*height;
 const fontsDirectory=socialCaptionRendererFonts();if(!ffmpegStatic||!fontsDirectory)return null;
 const graph=`[0:v]format=gray[f];[1:v]split=2[base][templatein];[base]format=gray[b];[templatein]subtitles='${escapeFilterPath(input.assPath)}':fontsdir='${escapeFilterPath(fontsDirectory)}',format=gray[e];[f][b][e]hstack=inputs=3[out]`;
 const args=['-hide_banner','-loglevel','error','-nostdin','-i',input.finalPath,'-i',input.baselinePath,'-filter_complex',graph,'-map','[out]','-an','-vsync','0','-pix_fmt','gray','-f','rawvideo','pipe:1'];
 const child=spawn(String(ffmpegStatic),args,{stdio:['ignore','pipe','pipe']});
 const timeout=setTimeout(()=>child.kill('SIGKILL'),120000);
 const exit=new Promise<number|null>(resolve=>{child.on('error',()=>resolve(null));child.on('close',code=>resolve(code));});
 child.stderr?.resume();
 // The decoded stream may span gigabytes, but only one three-panel frame is
 // retained. Total work remains bounded by the caller's dimensions/frame cap.
 const frame=Buffer.alloc(frameBytes);
 let filled=0,index=0;
 const missing:number[]=[];
 try{
  for await(const chunk of child.stdout!){
   for(let offset=0;offset<chunk.length;){
    const copied=Math.min(frameBytes-filled,chunk.length-offset);
    chunk.copy(frame,filled,offset,offset+copied);filled+=copied;offset+=copied;
    if(filled<frameBytes)continue;
    if(index>=frameCount){child.kill('SIGKILL');return null;}
    const tilePixels=new Uint32Array(Math.ceil(width/8)),tilePresent=new Uint32Array(tilePixels.length);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
     const row=y*stride,mask=Math.abs(frame[row+2*width+x]!-frame[row+width+x]!);
     if(mask<80)continue;
     const tile=x>>3;tilePixels[tile]!++;
     if(Math.abs(frame[row+x]!-frame[row+width+x]!)>=40)tilePresent[tile]!++;
    }
    if(tilePixels.some((pixels,tile)=>pixels>=32&&tilePresent[tile]!<pixels*0.35))missing.push(index);
    index++;filled=0;
   }
  }
  const code=await exit;
  return code===0&&index===frameCount&&filled===0?missing:null;
 }catch{child.kill('SIGKILL');return null;}finally{clearTimeout(timeout);child.kill('SIGKILL');}
}
/**
 * Same-render ASS mask versus independently encoded final/base videos.
 * A positive mask result alone is only a pixel-difference observation. The
 * formal G4 caption check needs additional frozen-source, simple-template,
 * and complete-frame proof; the mask cannot establish those by itself.
 */
export async function auditCaptionMaskFrames(input:{finalPath:string;baselinePath:string;assPath:string;expectedFinalSha256:string;expectedBaselineSha256:string;expectedAssSha256:string;durationSeconds:number;width:number;height:number;fps?:number;maxFrames?:number;frozenCues?:Array<{start:number;end:number;text:string}>}):Promise<CaptionMaskFrameAudit>{
 const {durationSeconds,width,height}=input;
 const [finalSha256,baselineSha256,assBytes,finalSize,baselineSize]=await Promise.all([fileDigest(input.finalPath),fileDigest(input.baselinePath),readFile(input.assPath),stat(input.finalPath),stat(input.baselinePath)]);
 const assSha256=digest(assBytes);
 const fail=(reason:string,count=0,active=0,missing:number[]=[])=>unknown(finalSha256,baselineSha256,assSha256,reason,count,active,missing);
 if(finalSha256!==input.expectedFinalSha256||baselineSha256!==input.expectedBaselineSha256||assSha256!==input.expectedAssSha256)return fail('最终媒体、同图无字幕基底或 ASS 原字节漂移');
 const fps=input.fps??30,maxFrames=input.maxFrames??1500;
 if(!Number.isFinite(durationSeconds)||durationSeconds<=0||durationSeconds>45||!Number.isInteger(width)||!Number.isInteger(height)||width<64||height<64||width*height>1280*720||!Number.isInteger(fps)||fps<1||fps>60||!Number.isInteger(maxFrames)||maxFrames<1||maxFrames>1800||finalSize.size>1024*1024*1024||baselineSize.size>256*1024*1024||assBytes.length>128*1024)return fail('逐帧字幕 mask 试验超出有界范围');
 if(!assBytes.includes(Buffer.from('[Events]'))||!assBytes.includes(Buffer.from('Dialogue:')))return fail('ASS 缺实际字幕事件');
 const fontsDirectory=socialCaptionRendererFonts();if(!fontsDirectory)return fail('渲染器字幕字体缺失或完整性校验失败');
 const plainCueBinding=input.frozenCues?auditPlainAssCueBinding({ass:assBytes.toString('utf8'),cues:input.frozenCues}):undefined;
 if(plainCueBinding?.status==='mismatch')return {...fail(`ASS 与冻结字幕源不一致:${plainCueBinding.reason}`),plainCueBinding};
 const [finalFrames,baselineFrames]=await Promise.all([input.finalPath,input.baselinePath].map(file=>runVisualFfmpeg(['-i',file,'-map','0:v:0','-an','-vsync','0','-f','framehash','pipe:1'],true,{timeoutMs:120000})));
 const finalRows=finalFrames.ok?frames(finalFrames.stdout.toString('utf8')):null,baseRows=baselineFrames.ok?frames(baselineFrames.stdout.toString('utf8')):null;
 if(!finalRows||!baseRows||finalRows.length>maxFrames||finalRows.length!==baseRows.length||finalRows.some((row,index)=>row.pts!==baseRows[index]?.pts||row.timeBase!==baseRows[index]?.timeBase))return fail('成片与无字幕基底的完整解码帧 PTS 不一致或超出上限',finalRows?.length??0);
 const scratch=await mkdtemp(path.join(tmpdir(),'social-caption-mask-'));
 try{
  const maskMetrics=path.join(scratch,'mask.txt'),deltaMetrics=path.join(scratch,'delta.txt');
  // Reconstruct the expected ASS over the actual same-render baseline.
  // Contrast is bidirectional: dark outlines on a bright scene are evidence,
  // while white glyphs indistinguishable from white scenery are not.
  const mask=`[templatein]subtitles='${escapeFilterPath(input.assPath)}':fontsdir='${escapeFilterPath(fontsDirectory)}',format=gray[expected];[expected][baseexpected]blend=all_expr='abs(A-B)',split=2[maskstat][maskcompare]`;
  const graph=`[0:v]format=gray[final];[1:v]split=2[baseinput][templatein];[baseinput]format=gray,split=2[baseactual][baseexpected];[final][baseactual]blend=all_expr='abs(A-B)'[delta];${mask};[maskstat]signalstats,metadata=print:key=lavfi.signalstats.YAVG:file='${escapeFilterPath(maskMetrics)}',nullsink;[delta][maskcompare]blend=all_expr='if(gte(B,80)*gte(A,40),255,0)',signalstats,metadata=print:key=lavfi.signalstats.YAVG:file='${escapeFilterPath(deltaMetrics)}'[out]`;
  const inspected=await runVisualFfmpeg(['-i',input.finalPath,'-i',input.baselinePath,'-filter_complex',graph,'-map','[out]','-an','-vsync','0','-f','null','-'],false,{timeoutMs:120000});
  if(!inspected.ok)return fail(`同图 mask 比对不可运行:${inspected.stderr.slice(-150)}`,finalRows.length);
  const maskRows=stats(await readFile(maskMetrics,'utf8')),deltaRows=stats(await readFile(deltaMetrics,'utf8'));
  const [timeNumerator,timeDenominator]=finalRows[0]!.timeBase.split('/').map(Number);
  if(!maskRows||!deltaRows||maskRows.length!==finalRows.length||deltaRows.length!==finalRows.length
    ||!timeNumerator||!timeDenominator||maskRows.some((row,index)=>Math.abs(row.seconds-deltaRows[index]!.seconds)>0.001
      ||Math.abs(row.seconds-finalRows[index]!.pts*timeNumerator/timeDenominator)>0.001))return fail(`ASS mask 与成片/基底的逐帧统计不完整或时钟漂移:${maskRows?.length??0}:${deltaRows?.length??0}`,finalRows.length);
  const active=maskRows.flatMap((row,index)=>row.average>1?[index]:[]);
  if(!active.length)return fail(`ASS mask 未产生可检测字形:${Math.max(...maskRows.map(row=>row.average)).toFixed(3)}`,finalRows.length);
  // Compare expected subtitle contrast with observed change in those same
  // regions. Independent x264 noise or packaging present in both branches
  // cannot stand in for a substantial expected ASS contribution.
  const missing=active.filter(index=>deltaRows[index]!.average<Math.max(0.08,maskRows[index]!.average*0.22));
  if(missing.length)return fail('至少一帧在 ASS 字形 mask 内缺少足量同图差异；不推定具体遮挡原因',finalRows.length,active.length,missing);
  const spatialMissing=await spatiallyMissingFrames({finalPath:input.finalPath,baselinePath:input.baselinePath,assPath:input.assPath,durationSeconds,width,height,fps,frameCount:finalRows.length});
  if(!spatialMissing)return fail('逐帧 ASS 字形空间覆盖检查未完整解码、执行失败或超时',finalRows.length,active.length);
  if(spatialMissing.length)return fail('至少一帧的局部 ASS 字形区域缺少同图差异；无法确认每个字符',finalRows.length,active.length,spatialMissing);
  const simplePixelProof=plainCueBinding?.status==='matched'?await proveSimpleCaptionPixels({finalPath:input.finalPath,baselinePath:input.baselinePath,assPath:input.assPath,width,height,expectedFrameCount:finalRows.length}):undefined;
  const [finalAfter,baselineAfter,assAfter]=await Promise.all([fileDigest(input.finalPath),fileDigest(input.baselinePath),fileDigest(input.assPath)]);
  if(finalAfter!==finalSha256||baselineAfter!==baselineSha256||assAfter!==assSha256)return fail('逐帧字幕检查期间最终媒体、基底或 ASS 字节发生变化',finalRows.length,active.length);
  return {status:'observed_mask_delta',...(plainCueBinding?{plainCueBinding}:{}),...(simplePixelProof?{simplePixelProof}:{}),finalSha256,baselineSha256,assSha256,frameCount:finalRows.length,activeFrameCount:active.length,missingFrameIndexes:[],reason:'有界逐帧 PTS 一致，同基底重建 ASS 的预期变化区域内存在字幕差异；此观察不等于自动字幕验收，简单像素证明仅适用其窄条件'};
 }catch(error){return fail(`逐帧 mask 观察失败:${String(error)}`,finalRows.length);}finally{await rm(scratch,{recursive:true,force:true});}
}
