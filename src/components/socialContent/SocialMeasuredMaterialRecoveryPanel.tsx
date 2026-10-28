import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Select,Tag} from 'antd';
import type {WeeklyContentNavigation} from '../../../shared/contracts/weeklyContentNavigation';
import type {SocialContentTaskDetail} from '../../../shared/contracts/socialContentWorkflow';
import type {WeeklyTaskWorkspace} from '../../../shared/contracts/weeklyTaskWorkspace';
import type {Material} from '../../lib/studioApiContracts';
import {getToken} from '../../lib/auth';
import {readWeeklyTaskWorkspace} from '../../lib/weeklyTaskWorkspaceApi';
import {MaterialRecoveryRejected,recoverMeasuredMaterial} from '../../lib/socialMeasuredMaterialRecoveryApi';
import {studioApi} from '../../lib/studioApi';

const themeLabels={factory:'工厂',product:'产品',consumer_demo:'DtoC',general:'通用'} as const;
type Props={target:WeeklyContentNavigation;task:SocialContentTaskDetail;onChanged?:()=>void};

/** Original weekly run only. The server owns eligibility and recovery. */
export default function SocialMeasuredMaterialRecoveryPanel({target,task,onChanged}:Props){
 const identity=JSON.stringify([target.scope,target.contentTaskId,target.runId,task.version]);
 const current=useRef(identity);current.current=identity;
 const [workspace,setWorkspace]=useState<WeeklyTaskWorkspace|null>(null),[materials,setMaterials]=useState<Material[]>([]),[selected,setSelected]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[unknown,setUnknown]=useState(false);
 const writing=useRef(false),storageKey=`material-recovery:${target.scope.tenantId}:${target.contentTaskId}:${target.runId}`;
 const active=(token:string|null)=>current.current===identity&&getToken()===token;
 const load=async()=>{
  const token=getToken();
  const [w,library]=await Promise.all([readWeeklyTaskWorkspace(target.scope),studioApi.listMaterials('library')]);
  if(!active(token))return;
  if(w.tenantId!==target.scope.tenantId||w.contentTaskId!==target.contentTaskId||w.runId!==target.runId||task.taskId!==target.contentTaskId||task.runId!==target.runId)throw Error('待补槽与当前周任务或原运行不一致，请刷新。');
  setWorkspace(w);
  const pending=sessionStorage.getItem(storageKey);
  if(pending){try{const original=JSON.parse(pending) as {command?:{jobId?:string;runId?:string}};if(original.command?.jobId===w.runtime.recovery.jobId&&original.command?.runId===w.runId&&['queued','running','retry_wait','reconciling'].includes(w.runtime.recovery.jobStatus??'')){sessionStorage.removeItem(storageKey);setUnknown(false);setMessage('已核验原任务已继续。');}}catch{/* Preserve an unreadable recovery record for inspection. */}}
  setMaterials(library.filter(m=>m.type==='video'&&m.scope==='own'&&m.usage!=='reference_only'));
 };
 useEffect(()=>{let cancelled=false;setWorkspace(null);setSelected({});setError('');setMessage('');setUnknown(sessionStorage.getItem(storageKey)!==null);
  void load().catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'待补素材读取失败。');});return()=>{cancelled=true;};
 },[identity]);
 async function refresh(){setError('');try{await load();}catch(e){setError(e instanceof Error?e.message:'待补素材读取失败。');}}
 async function upload(file:File){if(writing.current)return;writing.current=true;setBusy(true);setError('');const token=getToken();try{
  const result=await studioApi.uploadMaterialFile(file,{type:'video',folder:'upload',sourceType:'content-workbench'});
  if(!active(token))return;if(!result.ok)throw Error(result.error||'素材上传失败。');
  await load();if(active(token))setMessage('素材已上传；完成素材主题分析后，可选择并继续原任务。');
 }catch(e){if(active(token))setError(e instanceof Error?e.message:'素材上传结果待核验。');}finally{writing.current=false;if(active(token))setBusy(false);}}
 async function resume(slotId:string){if(writing.current||unknown||!workspace?.runtime.recovery.jobId||!target.runId)return;const materialId=selected[slotId];if(!materialId)return;
  const token=getToken(),command={action:'resume_material_supply' as const,jobId:workspace.runtime.recovery.jobId,runId:target.runId,expectedVersion:task.version,slotId,materialId};
  writing.current=true;setBusy(true);setError('');setMessage('');
  try{const operationKey=crypto.randomUUID();sessionStorage.setItem(storageKey,JSON.stringify({operationKey,command}));setUnknown(true);
   const receipt=await recoverMeasuredMaterial(task.taskId,command,operationKey);if(!active(token))return;
   sessionStorage.removeItem(storageKey);setUnknown(false);setMessage(`原任务已接收，状态：${receipt.status}。`);await load();onChanged?.();
  }catch(e){if(active(token)){if(e instanceof MaterialRecoveryRejected){sessionStorage.removeItem(storageKey);setUnknown(false);setError(`${e.message} 请刷新后重新选择。`);}else setError(`${e instanceof Error?e.message:'结果暂未取得。'} 请刷新查看原任务状态，避免重复提交。`);}}
  finally{writing.current=false;if(active(token))setBusy(false);}
 }
 if(!target.runId)return null;
 const slots=workspace?.runtime.pendingMaterials??[];
 if(!error&&!slots.length&&!unknown)return null;
 return <section aria-label="待补分镜素材" className="space-y-3 rounded-lg border border-border p-4">
  <h3 className="text-sm font-semibold">待补分镜素材</h3>
  {error&&<Alert type="warning" showIcon title={error}/>}
  {message&&<Alert type="success" showIcon title={message}/>}
  {unknown&&<Alert type="warning" showIcon title="原恢复请求结果待核验" description="请刷新查看原任务状态，暂不重复提交。"/>}
  {slots.map(slot=><div key={slot.shotId} className="space-y-2 rounded-lg border border-border p-3">
   <p className="text-sm">分镜 {slot.shotId} <Tag>{themeLabels[slot.theme]}</Tag>需要 {slot.requiredSeconds.toFixed(2)} 秒</p>
   <Select aria-label={`分镜 ${slot.shotId} 的素材`} className="w-full" placeholder="选择企业素材库中的视频" disabled={busy||unknown} value={selected[slot.shotId]||undefined}
    onChange={value=>setSelected(v=>({...v,[slot.shotId]:value}))} options={materials.map(m=>({value:m.id,label:`${m.name}${m.duration?` · ${m.duration.toFixed(1)} 秒`:''}`}))}/>
   <p className="text-xs text-text-secondary">提交时系统核验主题、可用时长及素材权限。</p>
   <Button type="primary" disabled={busy||unknown||!selected[slot.shotId]||!workspace?.runtime.recovery.jobId} onClick={()=>void resume(slot.shotId)}>提交素材并继续原任务</Button>
  </div>)}
  {slots.length>0&&<label className="block text-sm">上传补充视频 <input type="file" accept="video/*" disabled={busy||unknown} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void upload(file);}}/></label>}
  <Button disabled={busy} onClick={()=>void refresh()}>刷新任务与素材</Button>
 </section>;
}
