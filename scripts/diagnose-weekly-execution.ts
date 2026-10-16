const root='http://127.0.0.1:5177/api/overseas';
const {token}=await fetch(`${root}/auth/local-preview-session`,{method:'POST',headers:{Origin:'http://127.0.0.1:5177'}}).then(r=>r.json());
async function read(path:string){const r=await fetch(`${root}${path}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});return{status:r.status,body:await r.json().catch(()=>({error:'non_json_response'}))};}
const programs=(await read('/social-programs/')).body.items;
for(const program of programs){
 const packages=(await read(`/social-programs/${program.programId}/operating-packages`)).body.items;
 const pkg=packages.find(p=>p.packageId===program.activeWeeklyOperatingPackageRef?.id&&p.version===program.activeWeeklyOperatingPackageRef.version)??packages.sort((a,b)=>b.version-a.version)[0];if(!pkg)continue;
 const tasks=(await read(`/social-programs/${program.programId}/operating-packages/${pkg.packageId}/execution-tasks?version=${pkg.version}`)).body.items;
 const grouped={};const statuses={};
 for(const t of tasks){statuses[t.status]=(statuses[t.status]??0)+1;for(const reason of [...t.ownBlockingReasons,...(t.lastError?[t.lastError.code]:[])]){const key=`${t.schedule.stepKind}:${reason}`;(grouped[key]??=[]).push(t.taskId);}}
 const evidence=await read(`/social-programs/${program.programId}/operating-packages/${pkg.packageId}/producer-evidence?version=${pkg.version}`);
 for(const suffix of [`/operating-packages/${pkg.packageId}/sales-handoffs?version=${pkg.version}`,'/material-requests']){
  const result=await read(`/social-programs/${program.programId}${suffix}`);console.log(JSON.stringify({endpoint:suffix,status:result.status,count:result.body.items?.length,error:result.body.code??result.body.error}));
 }
 console.log(JSON.stringify({programId:program.programId,packageId:pkg.packageId,version:pkg.version,status:pkg.status,planningBlockers:pkg.planningBlockers,statuses,blockers:Object.entries(grouped).map(([reason,ids])=>({reason,count:ids.length,sample:ids[0]})),producerEvidence:{status:evidence.status,code:evidence.body.code??evidence.body.error,items:evidence.body.items,bindingOptions:evidence.body.bindingOptions}}));
}
