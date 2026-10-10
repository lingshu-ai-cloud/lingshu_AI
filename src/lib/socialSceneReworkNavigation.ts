import type {SocialContentTaskDetail} from '../../shared/contracts/socialContentWorkflow';
import type {SocialSceneReworkAvailability} from '../../shared/contracts/socialSceneRework';
/** Explicitly bind the current timestamp script to an actual task's replication scene.
 * Ordinals and overlap are never identity evidence; ambiguity blocks navigation. */
export function frozenSceneSlotId(task:SocialContentTaskDetail,scene:SocialSceneReworkAvailability['scenes'][number],slots:Array<{id:string;start:number;end:number}>):string|null{
 const source=task.replicationScript?.shots.filter(s=>s.shotId===scene.sceneId&&s.materialPlan?.shotId===scene.shotId)||[];
 if(source.length!==1||!scene.referenceShotId||source[0]!.referenceShotId!==scene.referenceShotId||!scene.sourceTiming)return null;
 const refs=task.referenceVideoAnalysis?.shots.filter(s=>s.shotId===scene.referenceShotId)||[];
 if(refs.length!==1||refs[0]!.startSeconds!==scene.sourceTiming.startSeconds||refs[0]!.endSeconds!==scene.sourceTiming.endSeconds)return null;
 const matches=slots.filter(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.start===source[0]!.startSeconds&&s.end===source[0]!.endSeconds);
 return matches.length===1&&slots.filter(s=>s.id===matches[0]!.id).length===1?matches[0]!.id:null;
}

export interface BoundProductionSlot {id:string;time:string;start:number;end:number;title:string;detail:string;sourceSceneId:string}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** The server has verified bytes and hashes; match its DTO to the exact saved
 * project snapshot and persisted slots before presenting any production media. */
export function verifiedProductionSlots(availability:SocialSceneReworkAvailability,project:{id:string;spec?:Record<string,unknown>}):BoundProductionSlot[]{
 const binding=availability.productionWorkspaceBinding,spec=project.spec;
 if(!binding||!spec||binding.projectId!==project.id||binding.tenantId!==availability.tenantId||binding.taskId!==availability.taskId||binding.runId!==availability.sourceRunId||binding.artifactId!==availability.parentArtifactId||spec.socialContentTaskId!==binding.taskId||spec.sourceWorkflowRunId!==binding.runId||!object(spec.automation)||spec.automation.managedBy!=='social_content_output'||!object(spec.socialProductionWorkspace))throw Error(availability.productionWorkspaceGap||'原成片缺少服务端核验的视频项目血缘。');
 const saved=spec.socialProductionWorkspace;
 for(const key of ['type','version','tenantId','taskId','runId','artifactId','artifactContentHash','projectId','projectVersion','specHash','baselineHash','recordHash'] as const)if(saved[key]!==binding[key])throw Error('视频项目绑定已变化，请重新读取真实生产快照。');
 if(JSON.stringify(saved.sceneMappings)!==JSON.stringify(binding.sceneMappings))throw Error('视频项目分镜绑定与服务端核验凭据不一致。');
 const analysis=object(spec.analysisResults)?spec.analysisResults:null,storyboard=object(analysis?.storyboard)?analysis.storyboard:null;
 const slots=Array.isArray(storyboard?.slots)?storyboard.slots:[],shooting=Array.isArray(spec.shootingSlots)?spec.shootingSlots:[],materials=Array.isArray(spec.materialSnapshots)?spec.materialSnapshots:[],assignments=object(spec.storyboardAssignments)?spec.storyboardAssignments:null;
 if(!binding.sceneMappings.length||slots.length!==binding.sceneMappings.length||shooting.length!==binding.sceneMappings.length||new Set(binding.sceneMappings.map(m=>m.sceneId)).size!==binding.sceneMappings.length||new Set(binding.sceneMappings.map(m=>m.slotId)).size!==binding.sceneMappings.length)throw Error('真实生产快照缺少唯一分镜身份。');
 return binding.sceneMappings.map(mapping=>{
  const match=slots.filter(s=>object(s)&&s.id===mapping.slotId&&s.sourceSceneId===mapping.sceneId),shots=shooting.filter(s=>object(s)&&s.id===mapping.sceneId&&s.slotId===mapping.slotId);
  if(match.length!==1||shots.length!==1)throw Error('真实生产分镜与拍摄槽身份不一致。');
  const slot=match[0] as Record<string,unknown>,materialId=assignments?.[mapping.slotId],media=materials.filter(m=>object(m)&&m.id===materialId&&m.contentHash===mapping.mediaSha256&&m.taskId===binding.taskId&&m.tenantId===binding.tenantId&&m.sourceType==='social-production-output');
  if(typeof materialId!=='string'||mapping.mediaFileRef!==`socialfile:${materialId}`||media.length!==1||typeof slot.start!=='number'||!Number.isFinite(slot.start)||slot.start<0||typeof slot.end!=='number'||!Number.isFinite(slot.end)||slot.end<=slot.start||['title','detail','time'].some(k=>typeof slot[k]!=='string'))throw Error('真实分镜素材、哈希或时间证据不一致。');
  return slot as unknown as BoundProductionSlot;
 });
}
function canonicalWorkspace(value:unknown):unknown{if(Array.isArray(value))return value.map(canonicalWorkspace);if(!object(value))return value;return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonicalWorkspace(value[k])]));}
export async function productionWorkspaceHash(value:unknown):Promise<string>{const bytes=new TextEncoder().encode(JSON.stringify(canonicalWorkspace(value)));const hash=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');}
export async function verifyProductionSnapshotHash(availability:SocialSceneReworkAvailability,project:{id:string;spec?:Record<string,unknown>}):Promise<void>{
 verifiedProductionSlots(availability,project);
 const binding=availability.productionWorkspaceBinding!,{socialProductionWorkspace,...snapshot}=project.spec!,{recordHash,...payload}=binding;
 if(await productionWorkspaceHash(snapshot)!==binding.specHash||await productionWorkspaceHash(payload)!==recordHash)throw Error('真实视频快照哈希与服务端已核验绑定不一致，请重新读取生产来源。');
}
