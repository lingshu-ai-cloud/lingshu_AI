/** Real HTTP rehearsal in a disposable local-store snapshot. No fake delivery,
 * account, supplier receipt, provider call or modification of existing runs. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const root=process.cwd(),tenant='local_tenant_preview_beauty_showcase_local_test';
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'lingshu-weekly-rehearsal-'));
const storeDir=path.join(sandbox,'local-store');fs.mkdirSync(storeDir);
const protectedFiles=['starter_social_content_tasks.json','workflow_runs.json','workflow_tasks.json','social_weekly_operating_packages.json'];
const originalHistory=protectedFiles.map(file=>fs.readFileSync(path.join(root,'data/local-store',file),'utf8'));
// Historical runs remain untouched in the original store. The isolated fresh
// first-login fixture deliberately contains enterprise inputs, not old plans.
const exclude=new Set(['weekly_goals.json','weekly_plans.json','workflow_runs.json','workflow_tasks.json','run_events.json','digital_employee_configs.json','digital_employee_config_versions.json']);
for(const file of fs.readdirSync(path.join(root,'data/local-store')))if(file.endsWith('.json')&&!exclude.has(file))fs.copyFileSync(path.join(root,'data/local-store',file),path.join(storeDir,file));
const port=Number(process.env.REHEARSAL_PORT||8792),base=`http://127.0.0.1:${port}/api/overseas`;
const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','server/index.ts'],{cwd:root,env:{...process.env,PORT:String(port),LINGSHU_LOCAL_PORT:String(port),LOCAL_STORE_DIR:storeDir,PROCESS_ROLE:'web',PROCESS_ROLE_SPLIT_ENABLED:'true',LINGSHU_LOCAL_PREVIEW:'1',ENABLE_LOCAL_DEV_FALLBACK:'true',LINGSHU_PREVIEW_AUTH_EMAIL:'beauty-showcase@local.test',LINGSHU_LOCAL_PUBLISHING_ACCOUNT_MOCKS:'0'},stdio:['ignore','ignore','ignore']});
let token='';
const request=async(route:string,body?:unknown)=>{
 const response=await fetch(`${base}/${route}`,{method:body===undefined?'GET':'POST',headers:{origin:'http://127.0.0.1:5177',...(token?{authorization:`Bearer ${token}`} :{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)});
 return{status:response.status,body:await response.json() as any};
};
try{
 for(let n=0;n<100;n++){
  if(child.exitCode!==null)throw Error('Isolated server exited');
  try{const h=await request('health');if(h.status===200){assert.equal(h.body.role,'web');assert.equal(h.body.capabilities.starter_workers.ready,false);break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 const session=await request('auth/local-preview-session',{});assert.equal(session.status,200);token=session.body.token;assert.ok(token);
 const liveBase='http://127.0.0.1:8791/api/overseas';
 const sessionLive=await(await fetch(`${liveBase}/auth/local-preview-session`,{method:'POST',headers:{origin:'http://127.0.0.1:5177'}})).json() as any;
 const current=await(await fetch(`${liveBase}/digital-employees/overview`,{headers:{authorization:`Bearer ${sessionLive.token}`}})).json() as any;
 const onboarding=await request('digital-employees/onboarding/complete',{
  ...current.config,minimalOnboarding:true,
  // Explicitly labelled fixture; never asserted to be the user's company.
  companyName:'隔离联调企业（测试输入）',brandName:'隔离联调品牌（测试输入）',targetMarkets:'North America',
  publishingTargets:[{platform:'youtube',accountId:'unconnected-test-account',accountLabel:'Not authorized'}],
  productionOnboarding:{schemaVersion:'fixed-yield.production-onboarding.v1',contact:{kind:'none',value:'',primaryCta:''},presenterPolicy:'local_video_only',output:{primaryLanguage:'en',aspectRatio:'9:16',resolution:'1080p'},includeOneRevision:true,confirmedAt:new Date().toISOString()},
 });
 assert.equal(onboarding.status,200,JSON.stringify(onboarding.body));
 assert.deepEqual(onboarding.body.config.publishingTargets,[]);
 assert.equal(onboarding.body.config.allowRealPublishing,false);assert.equal(onboarding.body.run,null);
 // Full settings update must still reject invalid accounts.
 const strict=await request('digital-employees/onboarding/complete',{...onboarding.body.config,publishingTargets:[{platform:'youtube',accountId:'foreign',accountLabel:'Untrusted'}]});
 assert.equal(strict.status,409);assert.equal(strict.body.error,'publishing_accounts_invalid');
 const day=new Date(Date.now()+8*3600000),offset=(day.getUTCDay()+6)%7;
 day.setUTCDate(day.getUTCDate()-offset);const startsAt=day.toISOString().slice(0,10);day.setUTCDate(day.getUTCDate()+6);const endsAt=day.toISOString().slice(0,10);
 const created=await request('digital-employees/goals',{businessLine:'content_growth',contentPlatforms:['youtube','tiktok','instagram','facebook'],title:'隔离联调：自然周5条原创',objective:'验证五条独立原创、四平台分发及真实执行门禁',metric:'approved_content_packages',baseline:0,target:5,unit:'条',startsAt,endsAt,scope:'North America',constraints:['每条成片不超过15元','无发布授权不发布','测试输入不作为真实企业身份']});
 assert.equal(created.status,201,JSON.stringify(created.body));
 const goal=created.body.goal,pack=created.body.plan?.businessPackage;
 const videos=pack?.tasks?.find((t:any)=>t.templateId==='production')?.videoPlans??[];
 const approval=await request(`digital-employees/goals/${goal.id}/approve`,{packageRevision:pack?.revision});
 const final=await request(`digital-employees/overview?goalId=${goal.id}`);
 assert.equal(final.body.run,null,'a rejected activation must not create a run');
 assert.equal(approval.status,409,'current known unsafe plan must not execute');
 protectedFiles.forEach((file,index)=>assert.equal(fs.readFileSync(path.join(root,'data/local-store',file),'utf8'),originalHistory[index],`original history changed:${file}`));
 const audit=fs.readdirSync(storeDir).filter(f=>f.includes('audit')).flatMap(f=>JSON.parse(fs.readFileSync(path.join(storeDir,f),'utf8')));
 assert.ok(audit.some((r:any)=>JSON.stringify(r).includes('unconnected-test-account')),'deferred invalid binding must be audited');
 console.log(JSON.stringify({sandbox,fixtureOnly:true,tenant,onboarding:{status:onboarding.status,invalidAccountsDeferred:true,strictSettingsStatus:strict.status},goal:{status:created.status,id:goal.id,startsAt:goal.startsAt,endsAt:goal.endsAt,target:goal.target},plan:{revision:pack?.revision,platforms:[...new Set(videos.map((v:any)=>v.platform))],slots:videos.length,originals:videos.filter((v:any)=>v.productionRole!=='platform_adaptation').length,detailsStatus:pack?.detailGeneration?.status??'not_generated'},activation:{httpStatus:approval.status,error:approval.body.error,message:approval.body.message,blockers:approval.body.blockers},run:final.body.run?.id??null,externalEffects:false},null,2));
}finally{child.kill('SIGTERM');await new Promise<void>(resolve=>child.once('exit',()=>resolve()));}
