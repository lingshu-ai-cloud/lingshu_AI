import '../server/loadEnvironment.js';
import fs from 'node:fs';
import path from 'node:path';
const runRoot=path.resolve('data/acceptance/integrated-flow-20261008');
process.env.LOCAL_STORE_DIR=path.join(runRoot,'local-store');
process.env.ENABLE_LOCAL_DEV_FALLBACK='true';
const tenantId='local_tenant_customer_1b2913131e2c46deab66172228c4df0a';
const referenceId='trend_videos_192e76d4b21244c4a2922e60672c95f2';
if(!fs.existsSync(path.join(process.env.LOCAL_STORE_DIR,'trend_videos.json')))throw Error('Initialize an independent local-store copy before running this acceptance script');
const obj=(x:any)=>typeof x==='string'?JSON.parse(x):x;
const {runWithDataAuthority}=await import('../server/storage/dataAuthority.js');
const {store}=await import('../server/storage/index.js');
const {readTenantEnterpriseProfile}=await import('../server/routes/enterprise.js');
const {collectProductionAssets}=await import('../server/digitalEmployees/contentProduction.js');
await runWithDataAuthority('local',async()=>{
 const profile=await readTenantEnterpriseProfile(tenantId);
 const assets=await collectProductionAssets(tenantId,profile);
 const ref:any=await store.getById('trend_videos',referenceId);const a=obj(ref.aiAnalysis);
 const localVideo=path.resolve('data',String(a.materialUrl).replace(/^\/media\//,'media/'));
 fs.writeFileSync(path.join(runRoot,'product-assets.json'),JSON.stringify(profile.products.items.map(x=>({name:x.name,sku:x.sku,imageUrl:x.imageUrl,images:x.images,videos:x.videos,sceneImages:x.sceneImages,packagingImages:x.packagingImages})),null,2));
 const inventory={tenantId,referenceId,referenceTitle:ref.title,referenceQuality:a.analysisQuality,referenceVideo:localVideo,videoExists:fs.existsSync(localVideo),company:profile.company.name,assets:assets.map(x=>({id:x.id,name:x.name,type:x.type,productName:x.productName,observations:x.observations?.slice(0,3),authorization:x.authorization}))};
 fs.writeFileSync(path.join(runRoot,'preflight.json'),JSON.stringify(inventory,null,2));
 console.log(JSON.stringify({phase:'preflight',referenceQuality:a.analysisQuality,videoExists:inventory.videoExists,assetCount:assets.length,inventory:path.join(runRoot,'preflight.json')}));

 if(process.argv.includes('--flow')) {
  const stateFile=path.join(runRoot,'flow-state.json');
  const {digitalEmployeesRouter,approveGoalForReview,reconcileDigitalEmployeeRun}=await import('../server/routes/digitalEmployees.js');
  async function route(method:string,routePath:string,body:any={},goalId='') {
   const layer=(digitalEmployeesRouter as any).stack.find((x:any)=>x.route?.path===routePath&&x.route.methods[method]);
   if(!layer) throw Error(`Missing route ${method} ${routePath}`);
   let code=200;let result:any;
   const response:any={locals:{tenantId,userId:'local-integrated-flow-operator'},status(n:number){code=n;return this},json(value:any){result=value;return this},headersSent:false};
   await layer.route.stack[0].handle({body,params:{goalId},headers:{}},response);
   fs.writeFileSync(path.join(runRoot,`route-${method}-${routePath.replace(/[^a-z]/gi,'_')}.json`),JSON.stringify({code,result},null,2));
   if(code>=400) throw Error(JSON.stringify({code,result}));
   return result;
  }
  let state:any=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{};
  if(!state.goalId) {
   // Only the copied acceptance store is reset; source workflow records are untouched.
   const snapshots=path.join(runRoot,'historical-workflows');fs.mkdirSync(snapshots,{recursive:true});
   for(const collection of ['weekly_goals','weekly_plans','workflow_runs','workflow_tasks','workflow_task_events','content_batch_plans','durable_operation_leases']) {
    const file=path.join(process.env.LOCAL_STORE_DIR!,`${collection}.json`);
    if(fs.existsSync(file))fs.copyFileSync(file,path.join(snapshots,`${collection}.json`));
    fs.writeFileSync(file,'[]');
   }
   const configs=await store.list<any>('digital_employee_configs',{where:{tenant_id:tenantId},perPage:100});
   const configRecord=configs.items.find((x:any)=>x.status==='active')||configs.items[0];
   const config=obj(configRecord.config);
   await store.update('digital_employee_configs',configRecord.id,{config:{...config,socialCadence:'每周制作1条短视频',videoLanguages:['en'],enabledWorkflows:['viral_clone'],allowRealPublishing:false,allowRealCustomerMessages:false,managedPublishingGrant:undefined}});
   const selected=assets.filter(x=>x.productName==='云朵泡沫卸妆蜜').map(x=>x.id);
   const videoPlan={route:'clone',referenceId,productName:'云朵泡沫卸妆蜜',theme:'以已采集的护肤工厂视频为结构参考，展示企业已有护肤产品与包装、使用画面；不得虚构工厂、研发能力、认证、年限或产品功效。',duration:33.58,language:'en',platform:'tiktok',presenter:'material',materialIds:selected,voice:'',estimatedCost:0};
   await route('post','/goals',{title:'合并分支完整流程：护肤产品爆款复刻',businessLine:'content_growth',objective:'由经营 Agent 拆解目标，编导 Agent 使用指定灵感视频结构，内容 Agent 用已授权企业素材制作1条可审核的英文竖屏成片。',metric:'approved_content_packages',baseline:0,target:1,unit:'条',startsAt:'2026-10-08',endsAt:'2026-10-14',scope:'仅制作与审核1条成片',constraints:['只使用企业真实产品和已授权素材','不复用对标原片作为成片素材','不对外发布','不得虚构研发、工厂、认证或功效'],contentPlatforms:['tiktok'],videoPlans:[videoPlan]});
   const goals=await store.list<any>('weekly_goals',{where:{tenant_id:tenantId},perPage:100});state.goalId=goals.items[0].id;
   fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
   console.log(JSON.stringify({phase:'goal_created',goalId:state.goalId}));
   const plans=await store.list<any>('weekly_plans',{where:{tenant_id:tenantId,goal_id:state.goalId},perPage:100});
   const pack=obj(plans.items[0].plan).businessPackage;
   pack.tasks=pack.tasks.filter((t:any)=>['readiness','director','production','review'].includes(t.templateId));
   pack.tasks.forEach((t:any)=>{t.ownerId='';t.ownerName='';if(t.templateId==='production')t.videoPlans=[videoPlan]});
   pack.matrixPlan=[];pack.authorization={mode:'each',accountIds:[],customerIds:[],maxPublishItems:0,maxCustomerMessages:0};
   pack.directorPlan={...pack.directorPlan,originalTarget:1,platformVersionTarget:1,publishTarget:0};
   const {compilePackage}=await import('../server/digitalEmployees/weeklyPackage.js');
   const {normalizeWeeklyGoal}=await import('../server/digitalEmployees/domain.js');
   await store.update('weekly_plans',plans.items[0].id,{plan:{...obj(plans.items[0].plan),...compilePackage(pack,normalizeWeeklyGoal({...goals.items[0],businessLine:goals.items[0].business_line,contentPlatforms:goals.items[0].content_platforms,startsAt:goals.items[0].starts_at,endsAt:goals.items[0].ends_at,videoPlans:[videoPlan]},config),config)}});
   state.packagePrepared=true;fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
  }
  if(!state.packagePrepared) {
   const {compilePackage}=await import('../server/digitalEmployees/weeklyPackage.js');
   const {normalizeWeeklyGoal}=await import('../server/digitalEmployees/domain.js');
   const plans=await store.list<any>('weekly_plans',{where:{tenant_id:tenantId,goal_id:state.goalId},perPage:100});const plan=plans.items[0];const body=obj(plan.plan);const pack=body.businessPackage;
   const config=body.configSnapshot;
   const goals=await store.list<any>('weekly_goals',{where:{tenant_id:tenantId,id:state.goalId},perPage:100});const goal=goals.items[0];
   const goalInput=normalizeWeeklyGoal({...goal,businessLine:goal.business_line,contentPlatforms:goal.content_platforms,startsAt:goal.starts_at,endsAt:goal.ends_at,videoPlans:obj(goal.scope).videoPlans},config);
   pack.tasks=pack.tasks.filter((t:any)=>['readiness','director','production','review'].includes(t.templateId));pack.tasks.forEach((t:any)=>{t.ownerId='';t.ownerName='';if(t.templateId==='production')t.videoPlans=goalInput.videoPlans});
   pack.matrixPlan=[];pack.authorization={mode:'each',accountIds:[],customerIds:[],maxPublishItems:0,maxCustomerMessages:0};pack.directorPlan={...pack.directorPlan,originalTarget:1,platformVersionTarget:1,publishTarget:0};pack.revision++;
   await store.update('weekly_plans',plan.id,{plan:{...body,...compilePackage(pack,goalInput,config)}});
   state.packagePrepared=true;fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
  }
  if(!state.runId) {
   const plans=await store.list<any>('weekly_plans',{where:{tenant_id:tenantId,goal_id:state.goalId},perPage:100});const plan=plans.items[0];const body=obj(plan.plan);const pack=body.businessPackage;
   for(const task of pack.tasks)if(task.templateId==='production')for(const video of task.videoPlans){video.materialIds=assets.filter(x=>x.productName===video.productName).map(x=>x.id);delete video.preproduction;}
   delete pack.detailGeneration;await store.update('weekly_plans',plan.id,{plan:{...body,businessPackage:pack}});

   console.log(JSON.stringify({phase:'director_preproduction_started',goalId:state.goalId}));
   await route('post','/goals/:goalId/package/details',{},state.goalId);
   const detailPlans=await store.list<any>('weekly_plans',{where:{tenant_id:tenantId,goal_id:state.goalId},perPage:100});
   const detailPack=obj(detailPlans.items[0].plan).businessPackage;
   console.log(JSON.stringify({phase:'director_preproduction_finished',details:detailPack.detailGeneration}));
   const approved=await approveGoalForReview(tenantId,'local-integrated-flow-operator',state.goalId,detailPack.revision,[]);
   fs.writeFileSync(path.join(runRoot,'goal-approval.json'),JSON.stringify(approved,null,2));
   if(approved.status>=400)throw Error(JSON.stringify(approved));
   const runs=await store.list<any>('workflow_runs',{where:{tenant_id:tenantId,goal_id:state.goalId},perPage:100});state.runId=runs.items[0].id;
   fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
  }
  console.log(JSON.stringify({phase:'reconcile',...state}));
  await reconcileDigitalEmployeeRun(tenantId,state.runId);
  const tasks=await store.list<any>('workflow_tasks',{where:{tenant_id:tenantId,run_id:state.runId},perPage:100});
  fs.writeFileSync(path.join(runRoot,'workflow-tasks.json'),JSON.stringify(tasks.items,null,2));
  console.log(JSON.stringify({phase:'workflow_snapshot',tasks:tasks.items.map((x:any)=>({id:x.id,key:x.task_key,status:x.status,error:x.error,output:x.output}))}));
 }
 if(process.argv.includes('--analyze')) {
  const {analysisTimelineQualityError}=await import('../server/lib/videoAnalysisCodec.js');
  console.log(JSON.stringify({phase:'reference_analysis_started',duration:ref.duration}));
  const {extractQwenAnalysisFrames}=await import('../server/routes/videos.js');
  const {analyzeVideoFramesWithQwen}=await import('../server/agents/qwen.js');
  const frames=await extractQwenAnalysisFrames(localVideo,30,Number(ref.duration));
  const generated=await analyzeVideoFramesWithQwen({frames,duration:Number(ref.duration),title:ref.title,analysisMode:'exact',signal:AbortSignal.timeout(360_000)});
  const problem=analysisTimelineQualityError(generated,Number(ref.duration),'exact');
  fs.writeFileSync(path.join(runRoot,'reference-analysis.json'),JSON.stringify({referenceId,analysis:generated,qualityProblem:problem},null,2));
  console.log(JSON.stringify({phase:'reference_analysis_finished',shots:generated.scriptDetails15s?.length,qualityProblem:problem}));
  if(problem) throw new Error(problem);
  const updated={...a,gemini:generated,analysisQuality:'video',analysisMode:'exact',analysisSource:'qwen-full-video-real-run',geminiStatus:'analyzed',analyzedAt:new Date().toISOString(),analysisReviewReasons:[]};
  await store.update('trend_videos',referenceId,{aiAnalysis:JSON.stringify(updated)});
 }
});
process.exit(0);
