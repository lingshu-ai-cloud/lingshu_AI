type Source = {id:string;name:string;type:string;duration:number;folder?:string;visualObservations?:string[];segments?:Array<{start:number;end:number;confidence?:number;needsReview?:boolean;action?:string;subject?:string[];observedFacts?:unknown}>};
/** Conservative automatic plan: use each source once; changing timestamps alone is not visual diversity. */
export function materialShotPlan(sources: Source[], duration: number) {
  const intervals = sources.filter(source=>source.type==='video').map(source=>({source,segments:(source.segments||[]).filter(s=>!s.needsReview && Number(s.confidence)>=.65 && s.end>s.start).map(segment=>({...segment,cursor:segment.start}))}));
  const plan:Array<{name:string;materialId:string;type:'video';folder:string;duration:number;effectiveDuration:number;targetStart:number;targetEnd:number;sourceStart:number;sourceEnd:number;observations:string[];role:string}>=[];
  let target=0, turn=0;
  const usedSources = new Set<string>();
  while (target < duration-.05 && plan.length<32) {
    const remaining=duration-target;
    let found=false;
    for(let offset=0;offset<intervals.length;offset++) {
      const index=(turn+offset)%intervals.length;
      const {source,segments}=intervals[index];
      if (usedSources.has(source.id)) continue;
      const available=segments.find(segment=>segment.end-segment.cursor>=Math.min(2,remaining)-.001);
      if(!available) continue;
      const unused = intervals.filter(item => !usedSources.has(item.source.id)).length;
      const length=Math.min(6, Math.max(2, remaining / Math.max(1, unused)), remaining, available.end-available.cursor);
      const facts=Array.isArray(available.observedFacts)?available.observedFacts.filter((v):v is string=>typeof v==='string'):[];
      const observations=[...facts,available.action||'',...(available.subject||[])].filter(Boolean);
      const sourceStart=available.cursor,sourceEnd=sourceStart+length;
      plan.push({name:source.name,materialId:source.id,type:'video',folder:source.folder||'social',duration:source.duration,effectiveDuration:length,targetStart:target,targetEnd:target+length,sourceStart,sourceEnd,
        observations:[`原片可用区间 ${sourceStart.toFixed(2)}-${sourceEnd.toFixed(2)} 秒`,...observations],role:plan.length?'外观细节':'开场外观'});
      usedSources.add(source.id);available.cursor=sourceEnd;target+=length;turn=(index+1)%intervals.length;found=true;break;
    }
    if(!found) break;
  }
  if(target<duration-.05) throw Error(`不循环使用同一视频时，当前素材只能支持约 ${target.toFixed(1)} 秒。请缩短成片时长或补充素材（不同角度、动作或场景），不能把同一长镜头反复截取当作新画面`);
  return plan;
}
