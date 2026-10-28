import type {SocialDirectorBriefScene} from '../../shared/contracts/socialContentAgentContract.js';

type Line = NonNullable<SocialDirectorBriefScene['voiceoverLines']>[number];
type Scene = {shotId:string; spokenText:string; lines?:Line[]};
export interface MeasuredSentenceSlot {
 lineId:string; text:string; visualShotIds:string[]; narrationOwnerShotId:string;
 startSeconds:number|null; endSeconds:number|null; timingSource:'measured_cue_boundaries'|'partial_cue_boundaries'|'unresolved_within_cue';
}
const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
/** Verify both directions: a sentence owns exactly one narration, and each
 * declared slot carries the same sentence record. Historic tasks without line
 * records retain their original behaviour. */
export function validateSentenceSlots(scenes:Scene[]):Line[]|null {
 if(!scenes.some(scene=>scene.lines?.length))return null;
 const ids=scenes.map(s=>s.shotId), lookup=new Map<string,{line:Line;seen:string[]}>();
 if(new Set(ids).size!==ids.length)throw Error('sentence_slot_duplicate_scene');
 for(const scene of scenes){
  const local=new Set<string>();
  for(const line of scene.lines??[]){
   if(!line.lineId||!normalize(line.text)||local.has(line.lineId)||!line.visualShotIds.length
    ||new Set(line.visualShotIds).size!==line.visualShotIds.length||!line.visualShotIds.includes(scene.shotId)
    ||!line.visualShotIds.includes(line.narrationOwnerShotId)||line.visualShotIds.some(id=>!ids.includes(id))
    ||line.isNarrationOwner!==(line.narrationOwnerShotId===scene.shotId))throw Error('sentence_slot_mapping_invalid');
   local.add(line.lineId);
   const old=lookup.get(line.lineId);
   if(old){const a=old.line;if(a.text!==line.text||a.narrationOwnerShotId!==line.narrationOwnerShotId
      ||JSON.stringify(a.visualShotIds)!==JSON.stringify(line.visualShotIds)||a.sourceStartSeconds!==line.sourceStartSeconds
      ||a.sourceEndSeconds!==line.sourceEndSeconds)throw Error('sentence_slot_mapping_inconsistent');old.seen.push(scene.shotId);}
   else lookup.set(line.lineId,{line,seen:[scene.shotId]});
  }
  if(normalize((scene.lines??[]).filter(line=>line.isNarrationOwner).map(line=>line.text).join(' '))!==normalize(scene.spokenText))
   throw Error('sentence_slot_narration_changed');
 }
 for(const {line,seen} of lookup.values())if(line.visualShotIds.length!==seen.length||line.visualShotIds.some(id=>!seen.includes(id)))throw Error('sentence_slot_mapping_incomplete');
 return scenes.flatMap(scene=>(scene.lines??[]).filter(line=>line.isNarrationOwner));
}
/** Only cue-edge timestamps are measured; never interpolate sentence times
 * inside a provider phrase. The slot timeline keeps its own provenance. */
export function measureSentenceSlots(lines:Line[],cues:Array<{start:number;end:number;text:string}>):MeasuredSentenceSlot[]{
 const starts=new Map<number,number>(),ends=new Map<number,number>();let cursor=0;
 for(const cue of cues){const text=normalize(cue.text);if(!text)continue;starts.set(cursor,cue.start);cursor+=text.length;ends.set(cursor,cue.end);}
 if(normalize(lines.map(line=>line.text).join(' '))!==normalize(cues.map(cue=>cue.text).join(' ')))throw Error('sentence_slot_alignment_text_changed');
 let offset=0;
 return lines.map(line=>{const start=starts.get(offset)??null;offset+=normalize(line.text).length;const end=ends.get(offset)??null;
  return {lineId:line.lineId,text:line.text,visualShotIds:[...line.visualShotIds],narrationOwnerShotId:line.narrationOwnerShotId,
   startSeconds:start,endSeconds:end,timingSource:start!==null&&end!==null?'measured_cue_boundaries':start!==null||end!==null?'partial_cue_boundaries':'unresolved_within_cue'};
 });
}
