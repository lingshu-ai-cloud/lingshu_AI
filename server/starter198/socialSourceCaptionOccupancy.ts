import { runStudioEmphasisPrepass } from '../lib/studioEmphasisPrepass.js';
import { STUDIO_CAPTION_OCCUPANCY_VERSION } from '../lib/studioCaptionOccupancy.js';
import type { CaptionOccupancy, NormalizedBox } from '../../shared/contracts/emphasisTimeline.js';
import type { SocialProductionAsset } from './socialContentProductionPlan.js';
import type { SocialSourceTextReview } from './socialSourceTextReview.js';

type Scene={sceneId:string;source:{assetId:string;sourceStart:number;sourceEnd:number}};
type Clip={sceneId:string;targetStart:number;targetEnd:number;trimStart?:number;trimEnd?:number};
type Cue={start:number;end:number;text:string};
type OccupancyAnalysis={captionOccupancy:CaptionOccupancy[]};

const overlaps=(left:{start:number;end:number},right:{start:number;end:number})=>left.start<right.end&&right.start<left.end;
const intersects=(box:NormalizedBox,region:NormalizedBox)=>box.x<region.x+region.width&&region.x<box.x+box.width
  &&box.y<region.y+region.height&&region.y<box.y+box.height;
const DEFAULT_CAPTION_REGION:NormalizedBox={x:.08,y:.62,width:.84,height:.32};
const UPPER_CAPTION_REGION:NormalizedBox={x:.08,y:.1,width:.84,height:.3};

function placement(boxes:NormalizedBox[]):'default'|'upper'|'unresolved'{
  const bottom=boxes.some(box=>intersects(box,DEFAULT_CAPTION_REGION));
  const upper=boxes.some(box=>intersects(box,UPPER_CAPTION_REGION));
  return !bottom?'default':!upper?'upper':'unresolved';
}

/** Map cached, measured source-video caption occupancy into the frozen target timeline. */
export async function measureSocialSourceCaptionOccupancy(input:{
  assets:SocialProductionAsset[];
  scenes:Scene[];
  timeline:Clip[];
  captionCues:Cue[];
  analyzeAsset?:(asset:SocialProductionAsset)=>Promise<OccupancyAnalysis>;
}):Promise<SocialSourceTextReview[]>{
  const usedIds=new Set(input.timeline.flatMap(clip=>{
    const scene=input.scenes.find(value=>value.sceneId===clip.sceneId);return scene?[scene.source.assetId]:[];
  }));
  const analyses=new Map<string,OccupancyAnalysis>();
  for(const asset of input.assets){
    if(!usedIds.has(asset.id)||asset.type!=='video'||!asset.localPath||!(asset.duration>0))continue;
    try{
      const result=input.analyzeAsset?await input.analyzeAsset(asset):await runStudioEmphasisPrepass({
        sourcePath:asset.localPath,durationMs:Math.round(asset.duration*1000),sourceHash:asset.contentHash,
      });
      analyses.set(asset.id,{captionOccupancy:result.captionOccupancy});
    }catch{/* Missing local analysis remains covered by the unmeasured review path. */}
  }
  const reviews:SocialSourceTextReview[]=[];
  for(const clip of input.timeline){
    const scene=input.scenes.find(value=>value.sceneId===clip.sceneId);if(!scene)continue;
    const analysis=analyses.get(scene.source.assetId);if(!analysis)continue;
    const sourceStart=clip.trimStart??scene.source.sourceStart,sourceEnd=clip.trimEnd??scene.source.sourceEnd;
    if(![sourceStart,sourceEnd,clip.targetStart,clip.targetEnd].every(Number.isFinite)||sourceEnd<=sourceStart||clip.targetEnd<=clip.targetStart)continue;
    const scale=(clip.targetEnd-clip.targetStart)/(sourceEnd-sourceStart);
    for(const item of analysis.captionOccupancy){
      const from=item.startMs/1000,to=item.endMs/1000,start=Math.max(sourceStart,from),end=Math.min(sourceEnd,to);
      if(end<=start||!item.boxes.length)continue;
      const targetStart=clip.targetStart+(start-sourceStart)*scale,targetEnd=clip.targetStart+(end-sourceStart)*scale;
      if(!input.captionCues.some(cue=>cue.text.trim()&&overlaps(cue,{start:targetStart,end:targetEnd})))continue;
      const decision=placement(item.boxes);
      reviews.push({sceneId:scene.sceneId,assetId:scene.source.assetId,sourceStart:start,sourceEnd:end,targetStart,targetEnd,
        text:item.text?.trim()||'',source:'measured_caption_occupancy',spatialStatus:'measured',
        status:decision==='unresolved'?'review_required':'avoided',boxes:item.boxes.map(box=>({...box})),
        placementDecision:decision,evidenceVersion:STUDIO_CAPTION_OCCUPANCY_VERSION});
    }
  }
  return reviews;
}

/** Measured evidence supersedes only an overlapping unmeasured hint for the same scene. */
export function mergeSocialSourceTextReviews(
  unmeasured:SocialSourceTextReview[],measured:SocialSourceTextReview[],
):SocialSourceTextReview[]{
  return [...unmeasured.filter(hint=>!measured.some(actual=>actual.sceneId===hint.sceneId
    &&overlaps({start:actual.targetStart,end:actual.targetEnd},{start:hint.targetStart,end:hint.targetEnd}))),...measured]
    .sort((left,right)=>left.targetStart-right.targetStart||left.sceneId.localeCompare(right.sceneId));
}
