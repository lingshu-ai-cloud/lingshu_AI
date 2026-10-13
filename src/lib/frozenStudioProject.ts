import type {BoundProductionSlot} from './socialSceneReworkNavigation';
export interface FrozenStudioProject {spec:Record<string,unknown>;slots:BoundProductionSlot[]}
/** Server projection owns identity and timing. A malformed bound plan must never become an editable legacy draft. */
export function frozenStudioProject(spec:Record<string,unknown>):FrozenStudioProject|null {
 const c=spec.resolvedStudioContract as Record<string,unknown>|undefined;if(!c)return null;
 if(c.schemaVersion!=='social-frozen-studio.v1'||c.readOnlyPlan!==true||!['tenantId','taskId','runId','jobId','planHash','inputHash','scriptVersion'].every(k=>typeof c[k]==='string'&&!!String(c[k]).trim())||!Number.isSafeInteger(Number(c.taskVersion))||Number(c.taskVersion)<1)throw Error('冻结生产身份不完整，请刷新原任务。');
 const timeline=spec.storyboardTimeline,shots=spec.shootingSlots;if(!Array.isArray(timeline)||!timeline.length||!Array.isArray(shots)||timeline.length!==shots.length||typeof spec.script!=='string'||!spec.script.trim()||typeof spec.primaryCta!=='string'||!spec.primaryCta.trim())throw Error('冻结分镜或英文文案缺失，请返回原任务。');
 const ids=new Set<string>();let lastEnd=0;const slots=timeline.map((raw,index)=>{const t=raw as Record<string,unknown>,id=String(t.id??t.shotId??t.sceneId??''),start=Number(t.start??t.startSeconds),end=Number(t.end??t.endSeconds),shot=shots[index] as Record<string,unknown>;if(!/^S\d{2,}$/.test(id)||ids.has(id)||shot.id!==id||shot.slotId!==id||!Number.isFinite(start)||!Number.isFinite(end)||Math.abs(start-lastEnd)>.001||end<=start||Math.abs(Number(shot.duration)-(end-start))>.001)throw Error('冻结分镜身份或时间轴不一致，请返回原任务。');ids.add(id);lastEnd=end;return{id,time:`${start}s–${end}s`,start,end,title:String(t.title??t.label??id),detail:String(t.detail??shot.detail??''),sourceSceneId:String(t.sourceSceneId??id)};});
 if(Math.abs(lastEnd-Number(spec.duration))>.001)throw Error('冻结成片时长不一致，请返回原任务。');return{spec:structuredClone(spec),slots};
}
export function restoreStudioSpec(saved:Record<string,unknown>):Record<string,unknown>{
 if(frozenStudioProject(saved))return structuredClone(saved);
 const productionContract=saved.studioProductionContract as Record<string,unknown>|undefined;
 if(productionContract?.schemaVersion==='studio-production-contract.v1'&&productionContract.authority==='project_spec')return structuredClone(saved);
 const analysis=saved.analysisResults as Record<string,any>|undefined,b=analysis?.storyboard??{},v=analysis?.voiceover??{},shots=analysis?.shots??{};
 return{...(b.script!==undefined?{script:b.script}:{}),...(b.assignments!==undefined?{storyboardAssignments:b.assignments}:{}),...(b.clipEdits!==undefined?{clipEdits:b.clipEdits}:{}),...(b.sourcePlans!==undefined?{storyboardSourcePlans:b.sourcePlans}:{}),...(b.assemblies!==undefined?{storyboardAssemblies:b.assemblies}:{}),...(v.text!==undefined?{voiceoverLines:v.text}:{}),...(v.drafts!==undefined?{voiceDrafts:v.drafts}:{}),...(v.audios!==undefined?{voiceoverAudios:v.audios}:{}),...(v.alignedCuesByLang!==undefined?{alignedCuesByLang:v.alignedCuesByLang}:{}),...(shots.shootingSlots!==undefined?{shootingSlots:shots.shootingSlots}:{}),...(shots.productions!==undefined?{shotProductions:shots.productions}:{}),...saved};
}
