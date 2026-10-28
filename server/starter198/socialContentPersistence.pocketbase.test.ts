import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync, spawn} from 'node:child_process';
import {mkdtemp, mkdir, copyFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer, type AddressInfo} from 'node:net';

// Exercise the actual 0.39.5 adapter: a permissive memory store cannot detect
// silently dropped fields or the resulting unfinished receipt and target claim.
test('PocketBase completes replication creation and preserves its reference projection', {
  skip: !process.env.PB_INTEGRATION_BINARY,
}, async t => {
  const binary = process.env.PB_INTEGRATION_BINARY!;
  const root = await mkdtemp(path.join(tmpdir(), 'social-content-pb-'));
  const migrations = path.join(root, 'migrations');
  const repair = '1793145600_persist_social_content_reference_outputs.js';
  await mkdir(migrations);
  for (const name of (await readdir('pb_migrations')).filter(name => name.endsWith('.js') && name !== repair)) {
    await copyFile(path.resolve('pb_migrations', name), path.join(migrations, name));
  }
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const flags = [`--dir=${path.join(root, 'data')}`, `--migrationsDir=${migrations}`];
  const email = 'isolated-content@example.test', password = 'Disposable-content-test-427!';
  execFileSync(binary, ['superuser', 'upsert', email, password, ...flags], {stdio:'ignore'});
  const launch = () => spawn(binary, ['serve', `--http=127.0.0.1:${port}`, ...flags], {stdio:['ignore','pipe','pipe']});
  let child = launch();
  let output = '';
  child.stdout.on('data',chunk => {output += String(chunk);});
  child.stderr.on('data',chunk => {output += String(chunk);});
  const keys = ['PB_URL','PB_ADMIN_EMAIL','PB_ADMIN_PASSWORD','ENABLE_LOCAL_DEV_FALLBACK','DATA_BACKEND'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
      child.kill(); await exited;
    }
  };
  t.after(async () => {
    await stop();
    for (const [key,value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, {recursive:true,force:true});
  });
  process.env.PB_URL = `http://127.0.0.1:${port}`;
  process.env.PB_ADMIN_EMAIL = email; process.env.PB_ADMIN_PASSWORD = password;
  process.env.ENABLE_LOCAL_DEV_FALLBACK = 'false'; process.env.DATA_BACKEND = 'pocketbase';
  const ready = async () => {
    for (let attempt = 0; ; attempt++) {
      try { if ((await fetch(`${process.env.PB_URL}/api/health`)).ok) break; } catch { /* starting */ }
      if (attempt > 600 || child.exitCode !== null) throw Error('isolated_pocketbase_not_ready: ' + output.slice(-2500));
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  await ready();
  const {pbStore} = await import('../storage/pbStore.js');
  const {getPbAdminToken} = await import('../storage/pb.js');
  // Existing deployments provision this prerequisite through setup-pb.ts.
  const defaults = await fetch(`${process.env.PB_URL}/api/collections`, {
    method:'POST',headers:{'Content-Type':'application/json',Authorization:(await getPbAdminToken())!},
    body:JSON.stringify({name:'studio_production_defaults',type:'base',fields:[
      {name:'tenant_id',type:'text',required:true},{name:'payload',type:'json',maxSize:2_000_000},
    ]}),
  });
  assert.equal(defaults.status,200);
  const {createStarter198Repository, STARTER_COLLECTIONS:C} = await import('./repository.js');
  const {executeSocialContentMutation} = await import('./socialContentMutation.js');
  const repository = createStarter198Repository(pbStore);
  const tenantId = 'isolated-content';
  let taskId = 'isolated-replication-before', operationKey = 'replication-content-before';
  const now = new Date().toISOString();
  const reference = {analysisId:'pending-reference',status:'pending',sourceId:'system-reference:pending'};
  let initialOrder = {schemaVersion:'social-content.order.v1',contentId:taskId,budgetTaskId:taskId};
  let applications = 0;
  const create = () => executeSocialContentMutation({repository,tenantId,userId:'operator',
    idempotencyKey:operationKey,requestHash:'same-request',operation:'create_social_content_task',
    targetId:'task-collection',
    replay: async () => ({taskId}),
    action: async operationId => {
      applications++;
      const task = await repository.create(C.socialContentTasks, tenantId, {
        task_id:taskId,brief:{formats:['social_image'],creationMode:'viral_replication'},
        content_order:initialOrder,package_selection:[{kind:'content'}],status:'plan_review',version:'1',
        source_count:0,knowledge_source_count:0,material_source_count:0,artifact_count:0,
        approved_artifact_count:0,delivery_package_count:0,publication_count:0,metric_submission_count:0,
        create_idempotency_key:operationKey,create_request_hash:'same-request',last_operation_id:operationId,
        created_by:'operator',updated_by:'operator',created_at:now,updated_at:now,
      });
      // Same write shape as refreshSocialTaskReferenceOutputs for a draft with
      // no attached reference yet. Before the repair PATCH returns 200, then
      // verification fails although last_operation_id and version persisted.
      await repository.update(C.socialContentTasks,tenantId,task.id,{
        formula_reference:'',director_plan:'',reference_video_analysis:reference,
        replication_script:'',shot_material_map:[],version:'2',
        last_operation_id:`${operationId}:reference-analysis`,updated_by:'operator',updated_at:now,
      });
      return {taskId};
    },
  });
  await assert.rejects(create(), {code:'starter_198_storage_unavailable'});
  const before = (await repository.list(C.socialContentTasks,tenantId)).items[0]!;
  assert.equal(before.version,'2');
  assert.match(String(before.last_operation_id),/:reference-analysis$/);
  assert.equal(before.reference_video_analysis,undefined,'old schema silently drops the analysis');
  assert.equal((await repository.list(C.socialContentOperations,tenantId)).items[0]?.status,'processing');
  const retainedClaims = (await pbStore.list('datastore_cas_claims')).totalItems;
  assert.equal(retainedClaims,1,'uncertain write is fenced instead of falsely acknowledged');
  await stop();
  await copyFile(path.resolve('pb_migrations',repair),path.join(migrations,repair));
  execFileSync(binary,['migrate','up',...flags],{stdio:'ignore'});
  child = launch();
  child.stdout.on('data',chunk => {output += String(chunk);});
  child.stderr.on('data',chunk => {output += String(chunk);});
  await ready();
  const upgraded = await repository.get(C.socialContentTasks,tenantId,before.id);
  assert.deepEqual(upgraded?.brief,before.brief);
  assert.equal(upgraded?.last_operation_id,before.last_operation_id);
  assert.equal(upgraded?.reference_video_analysis,null,'migration must not fabricate missing evidence');
  taskId = 'isolated-replication-fixed'; operationKey = 'replication-content-fixed'; applications = 0;
  initialOrder = {...initialOrder,contentId:taskId,budgetTaskId:taskId};
  await create();
  const row = (await repository.list(C.socialContentTasks,tenantId,{where:{task_id:taskId}})).items[0]!;
  assert.deepEqual(row.reference_video_analysis,reference);
  assert.deepEqual(row.shot_material_map,[]);
  assert.deepEqual(row.content_order,initialOrder);
  assert.equal(row.replication_script,'');
  assert.equal(row.formula_reference,'');
  const operation = (await repository.list(C.socialContentOperations,tenantId,{where:{idempotency_key:operationKey}})).items[0]!;
  assert.equal(operation.status,'succeeded');
  assert.equal((await create()).repeated,true);
  assert.equal(applications,1,'replay must not duplicate the content task');
  assert.equal((await repository.list(C.socialContentTasks,tenantId,{where:{task_id:taskId}})).totalItems,1);
  assert.equal((await pbStore.list('datastore_cas_claims')).totalItems,retainedClaims,'verified writes release only their own claims');
  assert.equal((await pbStore.list('durable_operation_leases')).totalItems,0);

  // Follow the real, free draft path up to an attached image reference. No
  // worker/queue is started and outbound supplier requests are prohibited.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url, init) => {
    const address = url instanceof Request ? url.url : String(url);
    assert.ok(address.startsWith(process.env.PB_URL! + '/'), `Unexpected external request: ${new URL(address).origin}`);
    return originalFetch(url, init);
  }) as typeof fetch;
  t.after(() => {globalThis.fetch = originalFetch;});
  const {normalizeProfile,writeTenantProfile} = await import('../routes/enterpriseProfileStore.js');
  const {createSocialContentTask} = await import('./socialContentTasks.js');
  const {createImageReplicationDraft} = await import('../../src/lib/imageReplicationDraft.js');
  const {createOrResumeBoundSocialImageRun} = await import('../socialImage/socialImageProductionRun.js');
  const {readSocialImageTask,updateSocialImageTask} = await import('../socialImage/socialImageTask.js');
  await writeTenantProfile(tenantId,normalizeProfile({products:{items:[{id:'product-a',name:'Test product'}]}} as never),'operator');
  const draftRepository = createStarter198Repository(pbStore,{materialLibrary:async () => ({items:[],totalItems:0}) as never});
  const draft = {reference:{url:'https://example.test/reference.png',title:'Selected reference'},
    product:{id:'product-a',name:'Test product'},objective:'Show the documented product',audience:'Buyers',
    platform:'facebook' as const,aspectRatio:'1:1' as const,language:'en' as const,callToAction:'Ask for details',budgetLimitCny:5};
  const createDraft = (operationKey = 'real-replication') => createImageReplicationDraft({draft,operationKey,entrySource:'assistant',isCurrent:() => true,
    ports:{
      createTask:(value,key) => createSocialContentTask({repository:draftRepository,tenantId,userId:'operator',idempotencyKey:key,value}),
      createOrResumeRun:(id,input) => createOrResumeBoundSocialImageRun(pbStore,tenantId,{...input,contentTaskId:id}),
      updateTask:async (task,patch) => {
        const result = await updateSocialImageTask(pbStore,tenantId,task.id,task.version,patch);
        assert.equal(result.kind,'updated');
        if (result.kind !== 'updated') throw Error('image_draft_update_failed');
        return {task:result.task};
      },
    },
  });
  const image = await createDraft();
  assert.ok(image.productionRuntime?.binding);
  assert.equal(image.referenceSnapshot?.imageUrls[0],draft.reference.url);
  assert.equal((await readSocialImageTask(pbStore,tenantId,image.id))?.referenceSnapshot?.imageUrls[0],draft.reference.url);
  assert.equal((await createDraft()).id,image.id,'transport replay must retain the same image run');
  assert.equal((await pbStore.list('content_execution_jobs',{where:{tenant_id:tenantId}})).totalItems,0);
  assert.equal((await pbStore.list('datastore_cas_claims')).totalItems,retainedClaims);

  // Reproduce the persisted production interruption, including its abandoned
  // target claim. Normal replay must finish the original creation receipt and
  // bind its image draft, without creating another content task or deleting a
  // claim whose full historical write payload is no longer available.
  const original = (await repository.list(C.socialContentTasks,tenantId,{
    where:{task_id:image.productionRuntime.binding.contentTaskId},
  })).items[0]!;
  const {id:_id,...copy} = original;
  const operationId = 'socialop_interrupted', recoveredId = 'interrupted-content';
  const interrupted = await repository.create(C.socialContentTasks,tenantId,{
    ...copy,task_id:recoveredId,create_idempotency_key:'interrupted-replication:content',
    content_order:null,reference_video_analysis:null,replication_script:null,shot_material_map:null,
    last_operation_id:`${operationId}:reference-analysis`,
  });
  const receipt = await repository.create(C.socialContentOperations,tenantId,{
    operation_id:operationId,idempotency_key:'interrupted-replication:content',request_hash:original.create_request_hash,
    operation:'create_social_content_task',target_id:'task-collection',status:'processing',
    result:{schemaVersion:'social-content.operation-processing.v1',operationId,targetId:'task-collection'},
    error_code:'',http_status:0,created_by:'operator',created_at:now,updated_at:now,
  });
  const claim = await pbStore.create<{id:string}>('datastore_cas_claims',{
    target_key:`starter_social_content_tasks:${interrupted.id}`,expected_fingerprint:'0'.repeat(64),
    operation_fingerprint:'1'.repeat(64),owner_token:'isolated-old-writer',
    created_at:new Date(0).toISOString(),lease_expires_at:new Date(0).toISOString(),
  });
  assert.ok(claim);
  const recovered = await createDraft('interrupted-replication');
  assert.ok(recovered.productionRuntime?.binding);
  assert.equal(recovered.productionRuntime.binding.contentTaskId,recoveredId);
  assert.equal(recovered.referenceSnapshot?.imageUrls[0],draft.reference.url);
  assert.equal((await repository.get(C.socialContentOperations,tenantId,receipt.id))?.status,'succeeded');
  assert.equal((await repository.list(C.socialContentTasks,tenantId,{where:{task_id:recoveredId}})).totalItems,1);
  assert.ok(await pbStore.getById('datastore_cas_claims',claim.id),'unproven historical claim is not silently released');
  assert.equal((await pbStore.list('content_execution_jobs',{where:{tenant_id:tenantId}})).totalItems,0);
});
