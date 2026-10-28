/** Fixed-slot mapping: measured phrase boundaries anchor the timeline. A cut
 * inside one measured phrase retains reference rhythm, never text-length timing. */
export interface MeasuredSceneInput { shotId:string; spokenText:string; startSeconds:number; endSeconds:number }
export interface MeasuredSceneTime { shotId:string; start:number; end:number; timingSource:'measured_boundary'|'reference_rhythm_between_audio_anchors'; anchorStart:number; anchorEnd:number }
const normalize=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function mapMeasuredSceneTimeline(input:{scenes:MeasuredSceneInput[];cues:Array<{start:number;end:number;text:string}>;durationSeconds:number}):MeasuredSceneTime[]{
 const {scenes,cues,durationSeconds:duration}=input;
 if(!scenes.length||!cues.length||!Number.isFinite(duration)||duration<=0)throw Error('measured_scene_timeline_input_missing');
 if(new Set(scenes.map(s=>s.shotId)).size!==scenes.length)throw Error('measured_scene_identity_duplicate');
 let textOffset=0,lastEnd=0;
 const measuredEnds=new Map<number,number>();
 for(const cue of cues){
  if(!Number.isFinite(cue.start)||!Number.isFinite(cue.end)||cue.start<lastEnd-.03||cue.end<=cue.start||cue.end>duration+.02)throw Error('presenter_whole_track_alignment_invalid');
  textOffset+=normalize(cue.text).length;measuredEnds.set(textOffset,cue.end);lastEnd=cue.end;
 }
 if(normalize(cues.map(c=>c.text).join(' '))!==normalize(scenes.map(s=>s.spokenText).join(' ')))throw Error('presenter_scene_alignment_not_unique');
 let sceneOffset=0,previousReferenceEnd=0;
 const anchors=[{index:0,time:0}];
 for(let i=0;i<scenes.length;i++){
  const scene=scenes[i]!;
  if(!Number.isFinite(scene.startSeconds)||!Number.isFinite(scene.endSeconds)||scene.startSeconds<previousReferenceEnd-.02||scene.endSeconds<=scene.startSeconds)throw Error('presenter_frozen_scene_timeline_missing');
  previousReferenceEnd=scene.endSeconds;sceneOffset+=normalize(scene.spokenText).length;
  const measured=measuredEnds.get(sceneOffset);
  if(i<scenes.length-1&&measured!==undefined&&normalize(scene.spokenText))anchors.push({index:i+1,time:measured});
 }
 anchors.push({index:scenes.length,time:duration});
 const result:MeasuredSceneTime[]=[];
 for(let a=1;a<anchors.length;a++){
  const left=anchors[a-1]!,right=anchors[a]!;
  if(right.time<=left.time)throw Error('measured_scene_anchor_order_invalid');
  const group=scenes.slice(left.index,right.index),total=group.reduce((n,s)=>n+s.endSeconds-s.startSeconds,0);
  let cursor=left.time;
  group.forEach((scene,index)=>{
   const end=index===group.length-1?right.time:cursor+(right.time-left.time)*(scene.endSeconds-scene.startSeconds)/total;
   result.push({shotId:scene.shotId,start:cursor,end,timingSource:group.length===1?'measured_boundary':'reference_rhythm_between_audio_anchors',anchorStart:left.time,anchorEnd:right.time});cursor=end;
  });
 }
 return result;
}
