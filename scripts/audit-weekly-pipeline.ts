const root='http://127.0.0.1:5177/api/overseas';
const session=await fetch(`${root}/auth/local-preview-session`,{method:'POST',headers:{Origin:'http://127.0.0.1:5177'}}).then(r=>r.json());
const headers={Authorization:`Bearer ${session.token}`};
const read=async(path:string)=>{const r=await fetch(root+path,{headers,signal:AbortSignal.timeout(30000)});return {status:r.status,data:await r.json()};};
const programId='7f9242c2-bdeb-40ea-ae59-6c2adbc96fad',packageId='39eedb9f-30c3-46bb-b5f3-3922a006644d';
const pkg=(await read(`/social-programs/${programId}/operating-packages/${packageId}`)).data.item;
const program=(await read(`/social-programs/${programId}`)).data.item;
const ready=(await read('/ready')).data;
console.log(JSON.stringify({program:{version:program?.version,route:program?.route},package:{version:pkg.version,status:pkg.status,authorityRefs:{goal:pkg.businessContentGoalRef,capacity:pkg.capacityPlanRef,policy:pkg.automationPolicyRef},planning:pkg.agentPlanning?{status:pkg.agentPlanning.status,version:pkg.agentPlanning.version,slotCount:pkg.agentPlanning.skeleton.slots.length,analysisCount:pkg.agentPlanning.directorAnalyses.length,directorGaps:pkg.agentPlanning.directorGaps}:null},ready:{weeklyExecution:ready.weeklyExecution,capabilities:ready.capabilities}}));
console.log(JSON.stringify({constraints:(await read(`/social-programs/${programId}/operating-constraints`)).data.item}));
if(process.argv.includes('--resolve-authority')){
 const response=await fetch(`${root}/social-programs/${programId}/operating-plan/resolve`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({weekStart:pkg.weekStart,desiredOriginalContents:pkg.socialContentPackage.originalContentTarget,desiredAdaptations:pkg.socialContentPackage.adaptationVersionTarget})});
 const result=await response.json(),r=result.item;
 console.log(JSON.stringify({authorityResolution:{httpStatus:response.status,error:result.error,message:result.message,goal:r?.goal?{status:r.goal.status,blockers:r.goal.blockers}:undefined,capacity:r?.capacityPlan,automation:r?.automationPolicy,snapshot:r?.snapshot?{version:r.snapshot.version,capabilities:r.snapshot.capabilityStates}:undefined,weeklyAuthority:result.weeklyAuthority}}));
}
const accounts=(await read(`/social-programs/${programId}/accounts`)).data.items??[];
if(process.argv.includes('--analyze')){
 const response=await fetch(`${root}/social-programs/${programId}/operating-packages/${packageId}/agent-planning/director-analysis`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({expectedPackageVersion:pkg.version,expectedPlanningVersion:pkg.agentPlanning.version,selectedSlotIds:pkg.agentPlanning.skeleton.slots.map((s:any)=>s.slotId)}),signal:AbortSignal.timeout(30000)});
 const result=await response.json();console.log(JSON.stringify({analysis:{status:response.status,planningStatus:result.item?.status,planningVersion:result.item?.version,analysisCount:result.item?.directorAnalyses?.length,gaps:result.item?.directorGaps,error:result.error,message:result.message}}));
}
console.log(JSON.stringify({accounts:accounts.map((a:any)=>({id:a.accountId,name:a.displayName,platform:a.platform,status:a.status,connectionId:a.connectionId,capabilities:a.connectionCapabilities,conversion:a.conversionRoute?{kind:a.conversionRoute.entryType,hasTarget:Boolean(a.conversionRoute.entryRef),verified:Boolean(a.conversionRoute.verifiedAt),hasOwner:Boolean(a.conversionRoute.handoffTarget)}:null}))}));

const base=`/social-programs/${programId}/operating-packages/${packageId}/execution-pipeline`;
if(process.argv.includes('--start-independent')){
 const response=await fetch(root+base+'/start-independent',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({expectedPackageVersion:pkg.version}),signal:AbortSignal.timeout(60000)});
 const result=await response.json();console.log(JSON.stringify({independentStart:{status:response.status,pipeline:result.pipeline,error:result.error,message:result.message}}));
}
if(process.argv.includes('--task-audit')){
 const result=await read(`${base}/task-audit?version=${pkg.version}`),audit=result.data.item;
 console.log(JSON.stringify({taskAudit:process.argv.includes('--compact')&&audit?{...audit,items:audit.items.map((i:any)=>({...i,rootCauses:[...new Set(i.rootCauses.map((r:any)=>r.code))]}))}:process.argv.includes('--details')?audit:{status:result.status,total:audit?.total,byStep:audit?.byStep,rootCounts:audit?.rootCounts,error:result.data.error}}));
}
if(process.argv.includes('--connect-consumer')){
 const response=await fetch(root+base+'/connect-local-consumer',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({expectedPackageVersion:pkg.version}),signal:AbortSignal.timeout(30000)});
 console.log(JSON.stringify({localConsumer:{status:response.status,result:await response.json()}}));
}
console.log(JSON.stringify({pipeline:await read(`${base}?version=${pkg.version}`)}));
if(process.argv.includes('--prepare-authority')){
 const response=await fetch(root+base+'/prepare-authority',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({expectedPackageVersion:pkg.version}),signal:AbortSignal.timeout(30000)});
 const result=await response.json(),resolution=result.resolution;
 console.log(JSON.stringify({preparation:{status:response.status,packageVersion:result.item?.version,goal:resolution?.goal?.status,goalBlockers:resolution?.goal?.blockers,capacity:resolution?.capacityPlan,automation:resolution?.automationPolicy,error:result.error,message:result.message}}));
}
