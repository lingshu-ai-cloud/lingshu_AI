import fs from 'node:fs';
export type TimedCue = { start: number; end: number; text: string };
export function verifiedAudioCues(raw: any, transcript: string, duration: number): TimedCue[] {
  const sentences=raw.transcripts?.[0]?.sentences || [];
  const cues: TimedCue[]=sentences.flatMap((s:any)=>Array.isArray(s.words)&&s.words.length?s.words:[s]).map((s:any)=>({start:Number(s.begin_time)/1000,end:Number(s.end_time)/1000,text:String(s.text||'')+String(s.punctuation||'')}));
  let end=0;
  for(const cue of cues){if(!cue.text.trim()||!Number.isFinite(cue.start)||!Number.isFinite(cue.end)||cue.start<end-.03||cue.end<=cue.start||cue.end>duration+.3)throw Error('音频对齐时间轴无效');end=cue.end}
  const normalize=(value:string)=>value.toLowerCase().replace(/you['’]re/g,'you are').replace(/[^\p{L}\p{N}]/gu,'');
  if(!cues.length||normalize(cues.map(c=>c.text).join(''))!==normalize(transcript))throw Error('实际音频与口播文本不一致，请复核文本');
  return cues;
}
export async function alignQwenFile(url:string,transcript:string,duration:number,cacheFile:string){
 const base=(process.env.DASHSCOPE_ASR_BASE_URL||'https://dashscope.aliyuncs.com/api/v1').replace(/\/$/,'');
 const headers={Authorization:'Bearer '+String(process.env.DASHSCOPE_API_KEY||''),'Content-Type':'application/json','X-DashScope-Async':'enable'};
 let cache:any={};try{cache=JSON.parse(fs.readFileSync(cacheFile,'utf8'))}catch{}
 if(cache.result)return verifiedAudioCues(cache.result,transcript,duration);
 const call=async(route:string,body?:any)=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const j:any=await r.json();if(!r.ok||j.code)throw Error('千问音频对齐服务暂不可用');return j};
 if(!cache.taskId){
  const task=await call('/services/audio/asr/transcription',{model:'qwen3-asr-flash-filetrans',input:{file_url:url},parameters:{channel_id:[0],enable_itn:false,enable_words:true}});
  if(!task.output?.task_id)throw Error('音频对齐未返回任务ID');
  cache={taskId:task.output.task_id};fs.writeFileSync(cacheFile,JSON.stringify(cache));
 }
 for(let i=0;i<12;i++){
  const state=await call('/tasks/'+encodeURIComponent(cache.taskId));
  if(state.output?.task_status==='FAILED')throw Error('音频对齐失败：'+String(state.output.code||'请重新生成音频'));
  if(state.output?.task_status==='SUCCEEDED'){
   const target=new URL(state.output.result.transcription_url);
   if(!/(^|\.)oss-[a-z0-9-]+\.aliyuncs\.com$/i.test(target.hostname))throw Error('音频字幕下载地址不可信');
   target.protocol='https:';
   const response=await fetch(target,{signal:AbortSignal.timeout(20000),redirect:'error'});if(!response.ok)throw Error('音频字幕下载失败');
   const result=await response.json();fs.writeFileSync(cacheFile,JSON.stringify({...cache,result}));
   return verifiedAudioCues(result,transcript,duration);
  }
  await new Promise(resolve=>setTimeout(resolve,1500));
 }
 throw Error('音频对齐仍在处理，请稍后重试；不会重复提交任务');
}
