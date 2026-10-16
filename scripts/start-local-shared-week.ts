/** Explicit user-authorized local replacement. Uses authenticated business APIs,
 * never edits records or manufactures authority/approval/delivery objects. */
import assert from 'node:assert/strict';
const base='http://127.0.0.1:8791/api/overseas',programId='7f9242c2-bdeb-40ea-ae59-6c2adbc96fad';
const session=await(await fetch(`${base}/auth/local-preview-session`,{method:'POST',headers:{origin:'http://127.0.0.1:5177'}})).json() as any;
assert.ok(session.token,'existing local preview login required');
const headers={authorization:`Bearer ${session.token}`,'content-type':'application/json'};
const call=async(route:string,body?:unknown)=>{
 const r=await fetch(`${base}/${route}`,{headers,...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
 const data=await r.json() as any;if(!r.ok)throw Error(JSON.stringify({route,status:r.status,...data}));return data;
};
const overview=await call('digital-employees/overview');
assert.equal(overview.run?.id,'workflow_runs_36a21592c83e42408d5902f45894a166');assert.equal(overview.run.status,'cancelled','old run must be formally cancelled first');
const prefix=`social-programs/${programId}`;
const {items:accounts}=await call(`${prefix}/accounts`);
const platforms=['youtube','tiktok','instagram','facebook'];
const selected=platforms.map(platform=>{const rows=accounts.filter((a:any)=>a.platform===platform);assert.equal(rows.length,1,'ambiguous account scope');return rows[0];});
const weekStart='2026-10-12',weekEnd='2026-10-18';
const objective='自然周5条原创共享四平台生产：旧运行取消后的联调计划';
const {items:packages}=await call(`${prefix}/operating-packages?weekStart=${weekStart}`);
let pkg=packages.find((p:any)=>p.objective===objective);
if(!pkg){
 assert.ok(process.argv.includes('--create'),'creation requires explicit --create');
 const publishDays=[[0,1,2,3,4],[0,1,2,3,4],[0,2,3,4,5],[1,2,4,5,6]];
 const date=(offset:number)=>new Date(Date.parse(`${weekStart}T00:00:00Z`)+offset*86400000).toISOString().slice(0,10);
 const publicationTasks=selected.flatMap((a:any,platformIndex:number)=>publishDays[platformIndex].map((offset,index)=>({accountId:a.accountId,publishWindow:`${date(offset)}T18:00:00+08:00`,businessProposition:`原创内容${index+1}：依据货盘与爆款分析确认选题，不作未经核验的产品承诺`,cta:'Contact us on WhatsApp to get your free sample.'})));
 pkg=(await call(`${prefix}/operating-packages`,{weekStart,objective,successCriteria:['5条独立原创成片，四平台共享母版，不重复生产计费','每条成片含修订不超过15元；未知费用保持占用','依赖按真实交付推进，缺授权与资料只阻塞对应分支','成片验收与发布许可在真实生产页面完成','周日回收真实交付与数据，不伪造回执'],originalContentTarget:5,weeklyBudgetCny:75,perItemBudgetCny:15,accountPlans:selected.map((a:any)=>({accountId:a.accountId,publicationCount:5})),publicationTasks,authorizationMode:'bounded',changeReason:'用户明确取消旧运行后创建自然周5条共享生产；账号授权、真实资料与验收保持门禁'})).item;
}
const content=pkg.socialContentPackage;
assert.equal(pkg.weekStart,weekStart);assert.equal(pkg.weekEnd,weekEnd);
assert.equal(content.productionIdentityVersion,'shared-original.v1');assert.equal(content.originalContentTarget,5);assert.equal(content.publicationTasks.length,20);assert.equal(content.authorization.allowRealPublishing,false);assert.equal(content.perItemBudgetCny,15);
assert.equal(new Set(content.publicationTasks.map((p:any)=>p.motherContentId)).size,5);
assert.equal(content.publicationTasks.filter((p:any)=>!p.adaptationOfPublicationTaskId).length,5);
const endpoint=`${prefix}/operating-packages/${pkg.packageId}/execution-pipeline`;
const pipeline=(await call(`${endpoint}?version=${pkg.version}`)).item;
console.log(JSON.stringify({packageId:pkg.packageId,version:pkg.version,weekStart,weekEnd,originals:5,publications:20,connectedAccounts:selected.filter((a:any)=>a.status==='connected').length,pipeline:{...pipeline,blockers:pipeline.blockers.map((b:any)=>b.code)}},null,2));
if(process.argv.includes('--prepare-authority')){
 const result=await call(`${endpoint}/prepare-authority`,{expectedPackageVersion:pkg.version});
 console.log(JSON.stringify({authority:{packageId:result.item?.packageId,version:result.item?.version,goalStatus:result.resolution?.goal?.status,goalGaps:result.resolution?.goal?.gaps,goalBlockers:result.resolution?.goal?.blockers,capacity:result.resolution?.capacityPlan,automation:result.resolution?.automationPolicy,blockers:result.resolution?.blockers}},null,2));
 if(result.item&&result.item.version!==pkg.version)process.exit(0); // re-read new immutable scope before starting
}
if(process.argv.includes('--start-independent')){
 const consumer=await call(`${endpoint}/connect-local-consumer`,{expectedPackageVersion:pkg.version});
 const result=await call(`${endpoint}/start-independent`,{expectedPackageVersion:pkg.version});
 console.log(JSON.stringify({consumer,pipeline:result.pipeline,audit:{total:result.audit?.total,byStep:result.audit?.byStep,rootCounts:result.audit?.rootCounts}},null,2));
}
