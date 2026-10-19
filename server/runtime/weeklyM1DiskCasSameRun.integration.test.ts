import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareWeeklyNonPresenterPlanningFixture } from './weeklyNonPresenterProduction.fixture.js';

/** Run the canonical local DataStore in a separate process. Its real disk CAS,
 * not the shared in-memory fixture, is exercised by formal planning and
 * pristine-package scheduling. */
test('M1 disk CAS creates a pristine package and rebuilds formal planning across restart', async t => {
  const fixture = await prepareWeeklyNonPresenterPlanningFixture(t, {
    ownedReferenceBytes: true,
    productInventory: true,
    primaryStructure: true,
    targetCta: 'Contact sales',
    metricTargets: ['播放目标1000', '点赞目标20', '评论目标5', '分享目标5'],
  });
  const directory = await mkdtemp(path.join(tmpdir(), 'weekly-m1-disk-cas-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const authFile = path.join(directory, 'local-auth-accounts.json');
  await writeFile(authFile, JSON.stringify([{ accountType: 'admin', userId: 'owner', tenantId: 't', email: 'owner@example.test', name: 'M1 test owner', salt: 'controlled-test-salt', passwordHash: 'controlled-test-hash', createdAt: '2026-10-01T00:00:00Z', role: 'admin' }]));
  for (const [collection, rows] of Object.entries(fixture.f.tables)) {
    if (!rows.length) continue;
    const file = path.join(directory, `${collection}.json`);
    await (await import('node:fs/promises')).writeFile(file, JSON.stringify(rows));
  }
  const record = fixture.f.tables.trend_videos?.find(row => row.id === fixture.referenceId);
  assert.ok(record?.videoFileId);
  const referencePath = path.resolve('data/media', String(record.videoFileId));
  const referenceHash = createHash('sha256').update(await readFile(referencePath)).digest('hex');
  assert.equal(JSON.parse(String(record.aiAnalysis)).contentSha256, referenceHash);

  const pbStoreUrl = new URL('../storage/pbStore.ts', import.meta.url).href;
  const authorityUrl = new URL('../storage/dataAuthority.ts', import.meta.url).href;
  const planningUrl = new URL('../socialPrograms/planningAuthority.ts', import.meta.url).href;
  const scheduleUrl = new URL('../socialPrograms/weeklyInitialSchedule.ts', import.meta.url).href;
  const packagesUrl = new URL('../socialPrograms/weeklyOperatingPackages.ts', import.meta.url).href;
  const decisionsUrl = new URL('../socialOperating/service.ts', import.meta.url).href;
  const capacityUrl = new URL('../socialOperating/capacityPlanner.ts', import.meta.url).href;
  const policyUrl = new URL('../socialOperating/automationPolicyResolver.ts', import.meta.url).href;
  const queueUrl = new URL('../contentExecution/durableQueue.ts', import.meta.url).href;
  const tasksUrl = new URL('../socialPrograms/executionTasks.ts', import.meta.url).href;
  const automaticUrl = new URL('../socialPrograms/weeklyAutomaticProductionPlanning.ts', import.meta.url).href;
  const workerUrl = new URL('./socialWeeklyExecutionWorker.ts', import.meta.url).href;
  const runtimeUrl = new URL('./socialWeeklyExecutionRuntime.ts', import.meta.url).href;
  const productionUrl = new URL('./socialWeeklyProductionAdapter.ts', import.meta.url).href;
  const repositoryUrl = new URL('../starter198/repository.ts', import.meta.url).href;
  const script = `
    const {pbStore:store}=await import(${JSON.stringify(pbStoreUrl)});
    const {runWithDataAuthority}=await import(${JSON.stringify(authorityUrl)});
    const {createWeeklyPlanningAuthority}=await import(${JSON.stringify(planningUrl)});
    const {createWeeklyInitialScheduleService}=await import(${JSON.stringify(scheduleUrl)});
    const {createWeeklyOperatingPackageService}=await import(${JSON.stringify(packagesUrl)});
    const {createSocialOperatingDecisionService}=await import(${JSON.stringify(decisionsUrl)});
    const {planCapacity}=await import(${JSON.stringify(capacityUrl)});
    const {resolveAutomationPolicy}=await import(${JSON.stringify(policyUrl)});
    const {setContentExecutionLimit}=await import(${JSON.stringify(queueUrl)});
    const {applyBusinessDispatchToExecutionTasks}=await import(${JSON.stringify(tasksUrl)});
    const {prepareWeeklyAutomaticProductionPlanning}=await import(${JSON.stringify(automaticUrl)});
    const {createSocialWeeklyExecutionWorker}=await import(${JSON.stringify(workerUrl)});
    const {createSocialWeeklyPlanningAdapter,WEEKLY_PREPRODUCTION_STEPS}=await import(${JSON.stringify(runtimeUrl)});
    const {createSocialWeeklyProductionAdapter}=await import(${JSON.stringify(productionUrl)});
    const {createStarter198Repository}=await import(${JSON.stringify(repositoryUrl)});
    await runWithDataAuthority('local',async()=>{
      if(!await store.supportsAtomicCompareAndSwap())throw Error('disk CAS unavailable');
      const packageRows=(await store.list('social_weekly_operating_packages',{where:{tenant_id:'t',program_id:'p',package_id:${JSON.stringify(fixture.pkg.packageId)},version:${fixture.pkg.version}}})).items;
      const source=packageRows[0]?.payload;
      if(!source||source.version!==${fixture.pkg.version})throw Error('source package absent');
      const packages=createWeeklyOperatingPackageService(store);
      let pkg;
      if(process.env.M1_REBUILD_PLANNING==='true'){
        const clock='2026-10-10T01:00:00Z',decisions=createSocialOperatingDecisionService(store,()=>clock);
        const goal=await decisions.getGoal('t','p',source.businessContentGoalRef.id,source.businessContentGoalRef.version);
        const options={operator:{type:'user',id:'owner'},decidedAt:clock};
        const capacity=planCapacity({goal,desiredOriginalContents:1,desiredAdaptations:0,costPerOriginalCny:6,costPerAdaptationCny:1,readyMaterialUnits:1,materialUnitsPerOriginal:1,productionItemsPerDay:1,daysUntilDeadline:7,accounts:[{ref:{type:'owned_social_account',id:'account',version:2},accountId:'account',status:'active',weeklyPublicationCapacity:1}],interactionItemsPerWeek:10,salesLeadsPerWeek:10,expectedInteractionsPerPublication:1,expectedLeadsPerPublication:1,capabilities:{'studio.production':'available','publishing.calendar':'available','customer.attribution':'available'}},options);
        await decisions.saveOperatingDecision('t','p',capacity.decision);
        const policy=resolveAutomationPolicy({goal,mode:'managed',action:'draft',capability:{key:'studio.production',availability:'available'},factsVerified:true,withinBudget:true,rightsSufficient:true},options);
        await decisions.saveOperatingDecision('t','p',policy.decision);
        pkg=await packages.create('t','owner','p',{weekStart:'2026-10-12',objective:source.objective,perItemBudgetCny:6,successCriteria:['实际制作一条待审核视频'],enterpriseProfileRef:source.enterpriseProfileRef,businessContentGoalRef:source.businessContentGoalRef,capacityPlanRef:{type:'capacity_plan',id:capacity.decision.decisionId,version:1},automationPolicyRef:{type:'automation_policy',id:policy.decision.decisionId,version:1},referenceSourcePolicy:source.referenceSourcePolicy,publicationTasks:source.socialContentPackage.publicationTasks.map(item=>({...item,publishWindow:'2026-10-15T10:00:00Z'}))});
      }else pkg=(await store.list('social_weekly_operating_packages',{perPage:500})).items.filter(row=>row.package_id!==source.packageId&&row.payload?.weekStart==='2026-10-12').sort((a,b)=>Number(a.version)-Number(b.version))[0]?.payload;
      if(!pkg)throw Error('fresh package absent');
      const planning=createWeeklyPlanningAuthority(store);
      const existing=(await store.list('social_weekly_agent_planning',{perPage:500})).items.filter(row=>row.tenant_id==='t'&&row.program_id==='p'&&row.package_id===pkg.packageId&&Number(row.package_version)===pkg.version);
      if(process.env.M1_REBUILD_PLANNING==='true'){
        const initial=await planning.initialize('t',pkg);
        const director=await planning.runDirectorAnalysis({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:initial.version,actor:'director_agent'});
        const detailed=await planning.mergeDetailedSchedule({tenantId:'t',programId:'p',package:pkg,expectedPlanningVersion:director.version,actor:'business_agent'});
        const confirmed=await planning.confirm({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:detailed.version,userId:'owner'});
        const dispatched=await planning.dispatch({tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,expectedPlanningVersion:confirmed.version,actor:'business_agent'});
        if(!dispatched.dispatch)throw Error('dispatch missing');
        await applyBusinessDispatchToExecutionTasks(store,'t','p',pkg.packageId,pkg.version,dispatched.dispatch,'2026-10-10T01:00:00Z');
      }
      else if(existing.length<1)throw Error('planning absent on restart');
      const rows=(await store.list('social_weekly_agent_planning',{perPage:500})).items.filter(row=>row.tenant_id==='t'&&row.program_id==='p'&&row.package_id===pkg.packageId&&Number(row.package_version)===pkg.version);
      if(rows.length<1)throw Error('formal planning absent');
      const latest=rows.sort((a,b)=>Number(b.planning_version)-Number(a.planning_version))[0];
      const owner=await store.getById('users','owner');if(!owner)throw Error('fixture owner absent');
      await store.update('users','owner',{tenantId:'t',role:'admin',active:true,disabled:false});
      const scheduling=createWeeklyInitialScheduleService(store,{now:()=> '2026-10-10T01:00:00Z'});
      const scope={tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version,actorUserId:'owner'};
      let scheduleTaskCount;
      if(process.env.M1_REBUILD_PLANNING==='true'){
        const preview=await scheduling.preview(scope),graph=preview.graph;
        scheduleTaskCount=graph.tasks.length;
        const clock='2026-10-10T01:00:00Z';
        for(const [limitScope,scopeKey]of [['tenant','*'],['account','account'],['task_type','social_content_weekly']])await setContentExecutionLimit({dataStore:store,tenantId:'t',scope:limitScope,scopeKey,maxRunning:2,updatedBy:'owner',now:new Date(clock)});
        const userCapacity={constraints:Object.fromEntries(graph.tasks.map(task=>[task.taskId,{resourceKey:'production',remainingMinutes:task.schedule.estimatedDurationMinutes,remainingCostCny:1,bufferMinutes:0,availableAt:clock}])),resources:{production:{concurrency:2,workingWindows:[{startAt:clock,finishAt:'2026-10-26T20:00:00Z'}]}},remainingBudgetCny:100,operationalDeadlines:Object.fromEntries(graph.tasks.filter(task=>['performance_monitoring','weekly_review','template_extraction','template_performance_validation'].includes(task.schedule.stepKind)).map(task=>[task.taskId,'2026-10-26T18:00:00Z']))};
        const proposal=await scheduling.propose(scope,userCapacity);
        if(proposal.plan.publicationGap!==0)throw Error('schedule publication gap '+JSON.stringify(proposal.plan));
        const confirmedSchedule=await scheduling.confirm(scope,{proposalId:proposal.proposalId,expectedVersion:pkg.version,inputEvidenceHash:proposal.inputEvidenceHash});
        const next=confirmedSchedule.item;
        const nextInitial=await planning.initialize('t',next);
        const nextDirector=await planning.runDirectorAnalysis({tenantId:'t',programId:'p',packageId:next.packageId,packageVersion:next.version,expectedPlanningVersion:nextInitial.version,actor:'director_agent'});
        const nextDetailed=await planning.mergeDetailedSchedule({tenantId:'t',programId:'p',package:next,expectedPlanningVersion:nextDirector.version,actor:'business_agent'});
        const nextConfirmed=await planning.confirm({tenantId:'t',programId:'p',packageId:next.packageId,packageVersion:next.version,expectedPlanningVersion:nextDetailed.version,userId:'owner'});
        const nextDispatched=await planning.dispatch({tenantId:'t',programId:'p',packageId:next.packageId,packageVersion:next.version,expectedPlanningVersion:nextConfirmed.version,actor:'business_agent'});
        if(!nextDispatched.dispatch)throw Error('scheduled dispatch missing');
        await applyBusinessDispatchToExecutionTasks(store,'t','p',next.packageId,next.version,nextDispatched.dispatch,clock);
        await packages.activate('t','owner','p',next.packageId,{expectedVersion:next.version,expectedProgramVersion:1,authorizePublishing:false});
        const tasks=(await store.list('social_weekly_execution_tasks',{perPage:500})).items.filter(row=>row.package_id===next.packageId&&Number(row.package_version)===next.version).map(row=>row.payload);
        const preparation=tasks.find(task=>task.schedule.stepKind==='material_preparation');if(!preparation)throw Error('material preparation missing');
        const due=new Date(Math.max(Date.now(),Date.parse(preparation.schedule.estimatedStartAt))+1);
        const worker=createSocialWeeklyExecutionWorker(store),adapter=createSocialWeeklyPlanningAdapter(store);
        let reachedPreparation=false;
        for(let attempt=0;attempt<12;attempt++){
          const claim=await worker.claimNext({tenantId:'t',workerId:'m1-disk-cas-worker',now:due});
          if(!claim)break;
          if(claim.task.taskId===preparation.taskId){
            reachedPreparation=true;
            const output=await createSocialWeeklyProductionAdapter(store,{repository:createStarter198Repository(store)}).execute(claim.task);
            if(output.status!=='blocked')throw Error('expected actual prerequisite blocker: '+JSON.stringify(output));
            await worker.defer(claim,{code:output.code,message:output.message,blockingReason:output.code,now:due});
            break;
          }
          if(!WEEKLY_PREPRODUCTION_STEPS.includes(claim.task.schedule.stepKind))throw Error('unexpected task before material preparation: '+claim.task.schedule.stepKind);
          const output=await adapter.execute(claim.task);
          if(output.status!=='succeeded')throw Error('formal planning adapter blocked: '+JSON.stringify(output));
          await worker.complete(claim,output.resultRefs,due);
        }
        if(!reachedPreparation)throw Error('formal worker did not reach material preparation');
        const automatic=await prepareWeeklyAutomaticProductionPlanning(store,{tenantId:'t',programId:'p',packageId:next.packageId,packageVersion:next.version},due.toISOString());
        if(automatic.status!=='not_ready'||automatic.code!=='weekly_automatic_production_opt_in_required')throw Error('manual dispatch unexpectedly became automatic authority: '+JSON.stringify(automatic));
      }
      else {
        scheduleTaskCount=(await store.list('social_weekly_execution_tasks',{perPage:500})).items.filter(row=>row.package_id===pkg.packageId&&Number(row.package_version)>pkg.version).length;
        const scheduledPackage=(await store.list('social_weekly_operating_packages',{perPage:500})).items.filter(row=>row.package_id===pkg.packageId&&Number(row.version)>pkg.version)[0]?.payload;
        if(!scheduledPackage)throw Error('scheduled package absent on restart');
        const preparation=(await store.list('social_weekly_execution_tasks',{perPage:500})).items.filter(row=>row.package_id===pkg.packageId&&Number(row.package_version)===scheduledPackage.version&&row.payload?.schedule?.stepKind==='material_preparation')[0]?.payload;
        if(!preparation||preparation.status!=='blocked')throw Error('blocked preparation absent on restart');
        const output=await createSocialWeeklyProductionAdapter(store,{repository:createStarter198Repository(store)}).execute(preparation);
        if(output.status!=='blocked'||output.code!=='weekly_production_authority_required')throw Error('restart changed authority stop: '+JSON.stringify(output));
        const automatic=await prepareWeeklyAutomaticProductionPlanning(store,{tenantId:'t',programId:'p',packageId:scheduledPackage.packageId,packageVersion:scheduledPackage.version},new Date().toISOString());
        if(automatic.status!=='not_ready'||automatic.code!=='weekly_automatic_production_opt_in_required')throw Error('restart minted automatic authority: '+JSON.stringify(automatic));
      }
      const scheduled=(await store.list('social_weekly_operating_packages',{perPage:500})).items.filter(row=>row.package_id===pkg.packageId&&Number(row.version)>pkg.version);
      const preparationRows=(await store.list('social_weekly_execution_tasks',{perPage:500})).items.filter(row=>row.package_id===pkg.packageId&&Number(row.package_version)>pkg.version&&row.payload?.schedule?.stepKind==='material_preparation');
      if(preparationRows.length!==1)throw Error('formal preparation task missing');
      const preparation=preparationRows[0].payload;
      const scheduledPackageId=scheduled[0]?.package_id;
      const intentRows=(await store.list('social_weekly_automatic_production_intents',{perPage:500})).items.filter(row=>row.package_id===scheduledPackageId);
      const authorityRows=(await store.list('social_weekly_production_planning_authorities',{perPage:500})).items.filter(row=>row.package_id===scheduledPackageId);
      const capacityRows=(await store.list('social_weekly_production_scope_capacities',{perPage:500})).items.filter(row=>row.package_id===scheduledPackageId);
      const contentRows=(await store.list('starter_social_content_tasks',{perPage:500})).items.filter(row=>String(row.create_idempotency_key||'').startsWith('weekly-production:'+scheduledPackageId+':'));
      console.log(JSON.stringify({packageId:pkg.packageId,version:pkg.version,planningVersion:latest.planning_version,status:latest.payload.status,scheduleTaskCount,scheduledVersion:scheduled[0]?.version??null,preparationStatus:preparation.status,preparationCode:preparation.lastError?.code??null,automaticIntentCount:intentRows.length,productionAuthorityCount:authorityRows.length,capacityProofCount:capacityRows.length,contentTaskCount:contentRows.length,contentRunIds:contentRows.map(row=>row.run_id||null)}));
    });`;
  const run = (rebuild: boolean) => new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'test', ENABLE_LOCAL_DEV_FALLBACK: 'true', LOCAL_STORE_DIR: directory, LOCAL_AUTH_ACCOUNTS_FILE: authFile, M1_REBUILD_PLANNING: rebuild ? 'true' : 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output) : reject(Error(output)));
  });
  const first = JSON.parse((await run(true)).trim());
  const restarted = JSON.parse((await run(false)).trim());
  assert.deepEqual(restarted, first);
  assert.equal(first.status, 'dispatched');
  assert.ok(first.scheduleTaskCount > 0);
  assert.ok(first.scheduledVersion > first.version);
  assert.equal(first.preparationStatus, 'blocked');
  assert.equal(first.preparationCode, 'weekly_production_authority_required');
  assert.equal(first.automaticIntentCount, 0, 'manual confirmation cannot mint automatic production intent');
  assert.equal(first.productionAuthorityCount, 0, 'manual confirmation cannot mint automatic production-only authority');
  assert.equal(first.capacityProofCount, 0, 'manual confirmation cannot mint an automatic production capacity proof');
  assert.equal(first.contentTaskCount, 1, 'manual planning may persist its scoped draft before the next authority gate');
  assert.deepEqual(first.contentRunIds, [null], 'an unbound weekly production draft cannot start a run');
  console.log('M1_DISK_CAS_STOP', JSON.stringify(first));
});
