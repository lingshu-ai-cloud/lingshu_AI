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



 if(process.argv.includes('--catalog-scenes')) {
  const {updateTenantEnterpriseProfile}=await import('../server/routes/enterprise.js');
  const {createHash}=await import('node:crypto');
  const state=JSON.parse(fs.readFileSync(path.join(runRoot,'flow-state.json'),'utf8'));
  fs.writeFileSync(path.join(runRoot,'profile-before-scene-associations.json'),JSON.stringify(profile,null,2));
  const products=structuredClone(profile.products);
  products.items[0].sceneImages=products.items.slice(1,6).map(product=>({name:`行业示意：目录中其他产品 ${product.name}（非本商品）`,type:'image',url:product.imageUrl}));
  await updateTenantEnterpriseProfile(tenantId,{products},'local-integrated-flow-operator');
  const refreshed=await readTenantEnterpriseProfile(tenantId);const updatedAssets=await collectProductionAssets(tenantId,refreshed);
  const selected=updatedAssets.filter(x=>x.productName==='云朵泡沫卸妆蜜');if(selected.length!==6)throw Error(`Expected 6 distinct catalog frames, got ${selected.length}`);
  const ordered=[selected[1],selected[0],...selected.slice(2)];
  const lines=["Choosing a skincare product starts with a clear look at what you are buying.","Here is GUIANFA Cloud Foam Cleansing Honey, shown in its original product packaging.","These additional packages are visual examples from the product catalog.","Before choosing a product, review its ingredient list and usage instructions for your market.","Request current specifications and sample options, then compare the details that matter to your business.","Ready to explore the range? Contact us with your product requirements."];
  const times=[0,6.1,11.5,16.3,22.2,28.6,33.58];
  const prior=JSON.parse(fs.readFileSync(path.join(runRoot,'director-script-revision-2.json'),'utf8')).contract;
  const script=ordered.map((asset,index)=>`[${times[index].toFixed(2)}-${times[index+1].toFixed(2)}s]\n环境：真实产品目录包装图\n景别：产品特写\n运镜：剪辑中轻微缩放\n构图：包装完整居中\n镜头功能：${index===0?'买家钩子':index===5?'询价引导':'目录信息展示'}\n画面：展示已上传产品素材中的实际可见主体：${asset.name}，只做轻微平移缩放。${index===1?'本商品真实主图':'其他产品作为目录选品示意，不表示它们是本商品'}\n画面来源：${asset.name}\n配乐：轻快电子配乐\n台词：${lines[index]}\n字幕：${lines[index]}`).join('\n\n');
  const contract={...prior,version:3,body:script,hash:createHash('sha256').update(JSON.stringify(script)).digest('hex'),generatedAt:new Date().toISOString(),source:'llm',degradedReason:''};
  fs.writeFileSync(path.join(runRoot,'director-script-revision-3.json'),JSON.stringify({source:'人工审核修订模型分镜',reason:'用真实目录的不同产品图提供独立画面；禁止冒充本商品或工厂实拍',contract,assetIds:ordered.map(x=>x.id)},null,2));
  const scenePlan=ordered.map(x=>({source:'material',materialId:x.id}));
  const projects=await store.list<any>('studio_projects',{where:{tenant_id:tenantId},perPage:500});
  for(const project of projects.items){const spec=obj(project.spec);if(spec.automation?.productionGraphId?.includes(state.runId)){
   spec.script=script;spec.scenePlanOrigin='user';spec.sceneSourcePlan=[];spec.sceneOverrides=ordered.map(x=>({source:'material',materialId:x.id,trimStart:0}));delete spec.productionDirection;
   spec.contentOrder.scripts={en:contract};spec.contentOrder.contractVersion=1;spec.contentOrder.videoPlan={...spec.contentOrder.videoPlan,materialIds:ordered.map(x=>x.id),scenePlan};
   spec.automation={...spec.automation,stage:'material_match',status:'queued',blocker:'',routePlan:{...spec.automation.routePlan,assetIds:ordered.map(x=>x.id)},contentVersion:3};
   await store.update('studio_projects',project.id,{spec,status:'draft'});
  }}
  const tasks=await store.list<any>('workflow_tasks',{where:{tenant_id:tenantId,run_id:state.runId},perPage:100});const task=tasks.items.find(x=>x.task_key==='content_production');
  // Fresh explicit input has resolved the recorded material gap; resume the same task.
  await store.update('workflow_tasks',task.id,{status:'pending',blocked_reason:'',output:{inputRepair:{reason:'已补充六组独立真实目录画面',assetIds:ordered.map(x=>x.id)}},updated_at:new Date().toISOString()});
  await store.update('workflow_runs',state.runId,{status:'running',pause_reason:''});
  console.log(JSON.stringify({phase:'catalog_scene_associations_ready',assets:ordered.map(x=>({id:x.id,name:x.name}))}));
 }
 if(process.argv.includes('--repair-script')) {
  const {createHash}=await import('node:crypto');
  const {callVideoModel}=await import('../server/digitalEmployees/videoModel.js');
  const {freezeStoryboardNarration}=await import('../server/digitalEmployees/contentProduction.js');
  const state=JSON.parse(fs.readFileSync(path.join(runRoot,'flow-state.json'),'utf8'));
  const lines=["Choosing a skincare product starts with a clear look at what you are buying.","Here is GUIANFA Cloud Foam Cleansing Honey, shown in its original product packaging.","The product information lists this item as a makeup removing cleanser.","Review the full ingredient list and usage instructions before adding it to your range.","Ask for current specifications and sample options to check the details for your market.","Want to explore this product? Contact us with your requirements."];
  const prompt=`请作为编导 Agent 修订被审核退回的分镜。之前脚本虚构不存在的泡沫实拍和标签放大，口播过长。唯一允许素材：云朵泡沫卸妆蜜主图，一张360x360原始产品包装图，白底，粉色盒包装，品牌GUIANFA。禁止增加实拍、人物、泡沫动作、标签额外文字、环境镜头、工厂、认证、功效。只能用这张图做裁切/平移/轻微缩放，整张包装不能裁掉品牌。参考叙事：买家提问→产品展示→核对信息→询价引导。英文口播已审核，严格逐字采用以下六句，不增加台词。制作33.58秒、六镜，时间连续覆盖0至33.58，按每句词数分配时间。每镜中文字段：环境、景别、运镜、构图、镜头功能、画面、画面来源（必须云朵泡沫卸妆蜜主图）、配乐、台词、字幕。只能给分镜文本，不输出markdown。句子：${JSON.stringify(lines)}`;
  console.log(JSON.stringify({phase:'director_script_repair_started'}));
  const result=await callVideoModel(prompt+' 改为只返回JSON对象 {"shots":[{"visual":"只描述静态包装图的裁切展示","camera":"剪辑中轻微缩放","composition":"包装完整居中"}]}，shots恰好6项。不输出台词或字幕，系统负责逐字插入已确认口播。',{timeoutMs:90000});
  fs.writeFileSync(path.join(runRoot,'director-repair-provider-output.txt'),result.text);
  const parsed=JSON.parse(result.text.replace(/^```(?:json)?\s*|\s*```$/g,''));if(parsed.shots?.length!==6)throw Error('Director repair did not return six scenes');
  const times=[0,6.1,11.5,16.3,22.2,28.6,33.58];
  const script=freezeStoryboardNarration(parsed.shots.map((shot:any,index:number)=>`[${times[index].toFixed(2)}-${times[index+1].toFixed(2)}s]\n环境：原产品包装主图\n景别：产品特写\n运镜：${shot.camera}\n构图：${shot.composition}\n镜头功能：${index===0?'买家钩子':index===5?'询价引导':'产品信息展示'}\n画面：${shot.visual}\n画面来源：云朵泡沫卸妆蜜主图\n配乐：轻快电子配乐\n台词：${lines[index]}\n字幕：${lines[index]}`).join('\n\n'),lines);
  const contract={version:2,body:script,hash:createHash('sha256').update(JSON.stringify(script)).digest('hex'),language:'en',status:'confirmed',generatedBy:'director_agent',generatedAt:new Date().toISOString(),source:'llm',degradedReason:''};
  fs.writeFileSync(path.join(runRoot,'director-script-revision-2.json'),JSON.stringify({reviewReason:'去除虚构视觉、功效承诺和超时口播；审核后由真实编导模型重新生成分镜',contract},null,2));
  const plans=await store.list<any>('weekly_plans',{where:{tenant_id:tenantId,goal_id:state.goalId},perPage:100});
  for(const plan of plans.items){const body=obj(plan.plan);for(const task of body.businessPackage.tasks)if(task.templateId==='production')for(const v of task.videoPlans)v.preproduction.directorScript=contract;await store.update('weekly_plans',plan.id,{plan:body});}
  const batches=await store.list<any>('content_batch_plans',{where:{tenant_id:tenantId,run_id:state.runId},perPage:100});
  for(const batch of batches.items){const orders=obj(batch.orders);for(const order of orders){order.contractVersion=1;order.scripts={en:contract};if(order.videoPlan?.preproduction)order.videoPlan.preproduction.directorScript=contract;}await store.update('content_batch_plans',batch.id,{orders});}
  const projects=await store.list<any>('studio_projects',{where:{tenant_id:tenantId},perPage:500});
  for(const project of projects.items){const spec=obj(project.spec);if(spec.automation?.productionGraphId?.includes(state.runId)){if(spec.automation.stage!=='script')throw Error('Repair must invalidate downstream artifacts before changing an in-production script');spec.contentOrder.scripts={en:contract};spec.contentOrder.contractVersion=1;await store.update('studio_projects',project.id,{spec});}}
  console.log(JSON.stringify({phase:'director_script_repair_finished',version:2}));
 }
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
   for(const collection of ['weekly_goals','weekly_plans','workflow_runs','workflow_tasks','workflow_task_events','content_batch_plans','studio_shooting_tasks','durable_operation_leases']) {
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
   let changed=false;
   for(const task of pack.tasks)if(task.templateId==='production')for(const video of task.videoPlans){const ids=assets.filter(x=>x.productName===video.productName).map(x=>x.id);if(JSON.stringify(ids)!==JSON.stringify(video.materialIds)||video.preproduction?.status!=='ready'){video.materialIds=ids;delete video.preproduction;changed=true;}}
   if(changed)delete pack.detailGeneration;await store.update('weekly_plans',plan.id,{plan:{...body,businessPackage:pack}});

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
  for(let step=0;step<(process.argv.includes('--advance-all')?8:1);step++) {
   await reconcileDigitalEmployeeRun(tenantId,state.runId);
   const projects=await store.list<any>('studio_projects',{where:{tenant_id:tenantId},perPage:500});
   const current=projects.items.filter(x=>obj(x.spec).automation?.productionGraphId?.includes(state.runId)).map(x=>{const spec=obj(x.spec);return {id:x.id,status:x.status,stage:spec.automation.stage,blocker:spec.automation.blocker,outputPath:spec.automation.renderOutputPath}});
   fs.writeFileSync(path.join(runRoot,'production-progress.json'),JSON.stringify(current,null,2));console.log(JSON.stringify({phase:'production_progress',step,projects:current}));
   if(current.some(x=>x.blocker)||current.length&&current.every(x=>x.stage==='completed'))break;
  }
  const tasks=await store.list<any>('workflow_tasks',{where:{tenant_id:tenantId,run_id:state.runId},perPage:100});
  fs.writeFileSync(path.join(runRoot,'workflow-tasks.json'),JSON.stringify(tasks.items,null,2));
  console.log(JSON.stringify({phase:'workflow_snapshot',tasks:tasks.items.map((x:any)=>({id:x.id,key:x.task_key,status:x.status,blockedReason:x.blocked_reason}))}));
 }
 if(process.argv.includes('--analyze')||process.argv.includes('--accept-analysis')) {
  const {analysisTimelineQualityError,parseAnalysisTimeRange}=await import('../server/lib/videoAnalysisCodec.js');
  console.log(JSON.stringify({phase:'reference_analysis_started',duration:ref.duration}));
  const {analyzeDownloadedVideoWithFallback}=await import('../server/routes/videos.js');
  const result=process.argv.includes('--accept-analysis')?{analysis:JSON.parse(fs.readFileSync(path.join(runRoot,'reference-analysis.json'),'utf8')).analysis}:await analyzeDownloadedVideoWithFallback({filePath:localVideo,mimeType:'video/mp4',title:ref.title,platform:ref.platform,duration:Number(ref.duration),sourceLabel:'integrated-flow-acceptance',analysisMode:'exact'});
  const generated=result.analysis;
  const observationDetails=generated.scriptDetails15s?.flatMap(shot=>{const range=parseAnalysisTimeRange(String(shot.time));return range&&range.end-range.start>5.5&&shot.beats?.length?shot.beats.map(beat=>({...shot,time:beat.time,visual:beat.action||shot.visual})): [shot]});
  const problem=analysisTimelineQualityError({...generated,scriptDetails15s:observationDetails},Number(ref.duration),'exact');
  fs.writeFileSync(path.join(runRoot,'reference-analysis.json'),JSON.stringify({referenceId,analysis:generated,qualityProblem:problem},null,2));
  console.log(JSON.stringify({phase:'reference_analysis_finished',shots:generated.scriptDetails15s?.length,qualityProblem:problem}));
  if(problem) throw new Error(problem);
  const updated={...a,gemini:generated,analysisQuality:'video',analysisMode:'exact',analysisSource:'qwen-full-video-real-run',geminiStatus:'analyzed',analyzedAt:new Date().toISOString(),analysisReviewReasons:[],analysisReviewRecord:{reviewedAt:new Date().toISOString(),reviewedBy:'local-integrated-flow-operator',evidence:'原视频全片采样核对；场景切点与原始观察窗口覆盖校验',sourceUncertainties:(generated as any).hookReviewReasons||[],limitations:'首秒动作存在观察不确定性，不用于成片中的产品功效或工厂能力声明'}};
  await store.update('trend_videos',referenceId,{aiAnalysis:JSON.stringify(updated)});
 }
});
process.exit(0);
