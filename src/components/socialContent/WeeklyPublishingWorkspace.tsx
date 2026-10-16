import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Popconfirm} from 'antd';
import type {WeeklyContentNavigation} from '../../../shared/contracts/weeklyContentNavigation';
import type {WeeklyExecutionTask,WeeklyOperatingPackage} from '../../../shared/contracts/socialProgram';
import {getToken} from '../../lib/auth';
import {socialProgramApi} from '../../lib/socialProgramApi';
import {readWeeklyContentNavigation} from '../../lib/weeklyContentNavigationApi';
import WeeklyContentProductionView from './WeeklyContentProductionView';
import {SocialWeeklyG6ReviewPanel} from './SocialWeeklyG6ReviewPanel';

/** Exact weekly binding, not the global content workspace's most recent task. */
export default function WeeklyPublishingWorkspace({target}:{target:WeeklyContentNavigation}){
 const [binding,setBinding]=useState(target),[tasks,setTasks]=useState<WeeklyExecutionTask[]>([]),[pkg,setPackage]=useState<WeeklyOperatingPackage|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const identity=JSON.stringify(target),token=getToken(),current=useRef('');current.current=identity+token;
 const active=()=>current.current===identity+token&&getToken()===token;
 useEffect(()=>setBinding(target),[identity]);
 useEffect(()=>{let live=true;setTasks([]);setPackage(null);setError('');void Promise.all([socialProgramApi.listExecutionTasks(target.scope.programId,target.scope.packageId,target.scope.packageVersion),socialProgramApi.getOperatingPackage(target.scope.programId,target.scope.packageId)]).then(([items,p])=>{if(!live||!active())return;if(p.version!==target.scope.packageVersion||items.some(t=>t.tenantId!==target.scope.tenantId||t.packageVersion!==target.scope.packageVersion))throw Error('当前周包或身份已变化，请返回原任务。');setTasks(items.filter(t=>t.publicationTaskId===target.publicationTaskId));setPackage(p);}).catch(e=>{if(live&&active())setError(e instanceof Error?e.message:String(e));});return()=>{live=false;};},[identity,token,revision]);
 const approval=tasks.filter(t=>t.schedule.stepKind==='user_approval');
 const accept=async()=>{if(busy||!binding.artifactRef||approval.length!==1||!active())return;setBusy(true);setError('');try{await socialProgramApi.approveExecutionTask(target.scope.programId,target.scope.packageId,approval[0]!.taskId,binding.artifactRef);const next=await readWeeklyContentNavigation(target.scope);if(active()){setBinding(next);setRevision(v=>v+1);window.dispatchEvent(new Event('lingshu:agent-business-refresh'));}}catch(e){if(active())setError(e instanceof Error?e.message:String(e));}finally{if(active())setBusy(false);}};
 const authorize=async()=>{if(busy||!pkg||!active())return;setBusy(true);setError('');try{await socialProgramApi.authorizeWeeklyPublishing(target.scope.programId,target.scope.packageId,target.scope.packageVersion);if(active())setRevision(v=>v+1);}catch(e){if(active())setError(e instanceof Error?e.message:String(e));}finally{if(active())setBusy(false);}};
 const accepted=approval.length===1&&approval[0]!.status==='succeeded';
 return <section className="space-y-4 p-5" aria-label="周任务成片验收与发布"><h2 className="text-lg font-bold">成片验收与发布许可</h2>
 {error&&<Alert showIcon type="error" title={error}/>}
 <WeeklyContentProductionView key={JSON.stringify(binding)} target={binding}/>
 <p className="text-sm">交付物：本条真实成片验收凭据，以及发布后的平台回执。缺少上游交付不会被标记为完成。</p>
 <Popconfirm title="确认验收这条真实成片？" description="将核验同源技术、编导审核及依赖；不包含发布许可。" onConfirm={()=>void accept()}><Button disabled={busy||!binding.artifactRef||approval.length!==1||accepted} loading={busy}>{accepted?'本条成片已验收':'验收本条成片'}</Button></Popconfirm>
 {pkg&&<section className="space-y-2 rounded-lg border p-4"><h3>本周有界发布许可</h3><p className="text-sm">{pkg.weekStart} — {pkg.weekEnd} · 当前周包 v{pkg.version} · 最多 {pkg.socialContentPackage.publicationTaskTarget} 条 · {pkg.socialContentPackage.authorization.accountIds.length} 个已选账号。修订周包后原许可失效；每条仍须真实成片验收与发布预检通过。</p>
 <Popconfirm title="允许当前周已确认排期自动发布？" description="只授权上述本周范围；不授权客服发消息，不绕过账号权限或服务端安全开关。" onConfirm={()=>void authorize()}><Button disabled={busy||pkg.status!=='active'||pkg.socialContentPackage.authorization.allowRealPublishing}>{pkg.socialContentPackage.authorization.allowRealPublishing?'本周发布许可已记录':'允许本周已确认排期自动发布'}</Button></Popconfirm>
 {pkg.status!=='active'&&<p className="text-sm">周包仍为草稿：需先处理目标、排期与派单缺项，不能提前授权发布。</p>}</section>}
 {binding.runId&&binding.artifactRef&&<SocialWeeklyG6ReviewPanel key={JSON.stringify(binding)} scope={{tenantId:binding.scope.tenantId,taskId:binding.contentTaskId,runId:binding.runId,artifactId:binding.artifactRef.id,programId:binding.scope.programId,packageId:binding.scope.packageId,packageVersion:binding.scope.packageVersion,publicationTaskId:binding.publicationTaskId}} onChanged={()=>setRevision(v=>v+1)}/>}
 </section>;
}
