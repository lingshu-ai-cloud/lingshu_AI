import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdtemp,open,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';

export interface FullFrozenAudioAudit {
  status:'matched'|'failed'|'unknown';
  finalSha256:string; frozenSha256:string;
  checkedWindows:number; voicedWindows:number; failedWindowIndexes:number[];
  reason:string;
}
async function digestFile(file:string){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk as Buffer);return hash.digest('hex');}
const unknown=(finalSha256:string,frozenSha256:string,reason:string):FullFrozenAudioAudit=>({status:'unknown',finalSha256,frozenSha256,checkedWindows:0,voicedWindows:0,failedWindowIndexes:[],reason});
function rms(bytes:Buffer,start=0,end=bytes.length){let sum=0;for(let i=start;i<end;i+=2){const sample=bytes.readInt16LE(i);sum+=sample*sample;}return Math.sqrt(sum/Math.max(1,(end-start)/2));}
function correlation(a:Buffer,b:Buffer,coreStart:number,coreEnd:number):number|null{
 let best=-2;
 // Decode delay is global. Small AAC mux offsets are tolerated, but each
 // independent window must match rather than borrowing a good midpoint.
 for(let shift=-960;shift<=960;shift+=40){
  let dot=0,aa=0,bb=0;
  const first=Math.max(coreStart,-shift),last=Math.min(coreEnd,a.length/2,b.length/2-shift);
  for(let i=first;i<last;i+=4){const x=a.readInt16LE(i*2),y=b.readInt16LE((i+shift)*2);dot+=x*y;aa+=x*x;bb+=y*y;}
  if(aa>1e8&&bb>1e8)best=Math.max(best,dot/Math.sqrt(aa*bb));
 }
 return best===-2?null:best;
}
/** Full-track waveform identity, not lip sync or spoken-content recognition. */
export async function auditFullFrozenAudio(input:{finalPath:string;frozenPath:string;expectedFinalSha256:string;expectedFrozenSha256:string;durationSeconds:number}):Promise<FullFrozenAudioAudit>{
 const [finalStat,frozenStat]=await Promise.all([stat(input.finalPath),stat(input.frozenPath)]);
 const expectedSamples=Math.round(input.durationSeconds*8000);
 if(!Number.isFinite(input.durationSeconds)||input.durationSeconds<=0||!Number.isSafeInteger(expectedSamples)||expectedSamples<1||finalStat.size>1024*1024*1024||frozenStat.size>256*1024*1024)return unknown('','','全音轨核验输入时长或媒体大小无效');
 const [finalSha256,frozenSha256]=await Promise.all([digestFile(input.finalPath),digestFile(input.frozenPath)]);
 const fail=(reason:string)=>unknown(finalSha256,frozenSha256,reason);
 if(finalSha256!==input.expectedFinalSha256||frozenSha256!==input.expectedFrozenSha256)return fail('最终 MP4 或冻结主音轨字节与已冻结 SHA 不一致');
 const root=await mkdtemp(path.join(tmpdir(),'lingshu-full-audio-'));
 try{
  const finalPcmPath=path.join(root,'final.pcm'),frozenPcmPath=path.join(root,'frozen.pcm');
  const decode=(source:string,target:string)=>runVisualFfmpeg(['-y','-i',source,'-map','0:a:0','-vn','-ac','1','-ar','8000','-f','s16le',target],false,{timeoutMs:120000});
  const [finalPcm,frozenPcm]=await Promise.all([decode(input.finalPath,finalPcmPath),decode(input.frozenPath,frozenPcmPath)]);
  if(!finalPcm.ok||!frozenPcm.ok)return fail('完整 PCM 音轨不可解码');
  const [aStat,bStat]=await Promise.all([stat(frozenPcmPath),stat(finalPcmPath)]),aSamples=aStat.size/2,bSamples=bStat.size/2;
  if(aStat.size<2||bStat.size<2||aStat.size%2||bStat.size%2)return fail('完整 PCM 音轨不可解码');
  if(Math.abs(aSamples-expectedSamples)>960||Math.abs(bSamples-expectedSamples)>960||Math.abs(aSamples-bSamples)>960)return fail('冻结音轨与最终音轨时长超出 120ms 容差');
  const ranges:Array<{start:number;end:number}>=[];
  for(let start=0;start<expectedSamples;start+=8000){const end=Math.min(expectedSamples,start+8000);if(end-start<1600&&ranges.length)ranges[ranges.length-1]!.end=end;else ranges.push({start,end});}
  let voicedWindows=0;const failedWindowIndexes:number[]=[];
  const [aFile,bFile]=await Promise.all([open(frozenPcmPath,'r'),open(finalPcmPath,'r')]);
  try{
   for(const [index,range] of ranges.entries()){
    const readStart=Math.max(0,range.start-960),readEnd=Math.min(Math.min(aSamples,bSamples),range.end+960),bytes=(readEnd-readStart)*2;
    if(bytes<3200)return fail('末端音频窗口不足以核验');
    const a=Buffer.alloc(bytes),b=Buffer.alloc(bytes),[ar,br]=await Promise.all([aFile.read(a,0,bytes,readStart*2),bFile.read(b,0,bytes,readStart*2)]);
    if(ar.bytesRead!==bytes||br.bytesRead!==bytes)return fail('完整 PCM 音轨窗口读取不完整');
    const coreStart=range.start-readStart,coreEnd=Math.min(range.end,readEnd)-readStart;
    if(coreEnd-coreStart<800)return fail('末端音频窗口不足以核验');
    const frozenRms=rms(a,coreStart*2,coreEnd*2),outputRms=rms(b,coreStart*2,coreEnd*2);
    if(frozenRms<40&&outputRms<40)continue;
    voicedWindows++;
    if(frozenRms<40||outputRms<40||(correlation(a,b,coreStart,coreEnd)??-1)<0.9)failedWindowIndexes.push(index);
   }
  }finally{await Promise.all([aFile.close(),bFile.close()]);}
  const [finalAfter,frozenAfter]=await Promise.all([digestFile(input.finalPath),digestFile(input.frozenPath)]);
  if(finalAfter!==finalSha256||frozenAfter!==frozenSha256)return fail('完整 PCM 测量期间媒体字节发生变化');
  if(!voicedWindows)return fail('冻结音轨没有可辨识的有声窗口');
  return {status:failedWindowIndexes.length?'failed':'matched',finalSha256,frozenSha256,checkedWindows:ranges.length,voicedWindows,failedWindowIndexes,reason:failedWindowIndexes.length?'最终 MP4 至少一个完整时间窗的声学波形与冻结主音轨明显不一致':'冻结主音轨与最终 MP4 在全部有声时间窗声学一致；未证明口型同步、语音内容转写或隐私'};
 }finally{await rm(root,{recursive:true,force:true});}
}
