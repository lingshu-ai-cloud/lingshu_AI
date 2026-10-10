import { createSocialProgramsRouter } from './socialPrograms.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { prepareWeeklyEnterpriseFactFixture } from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import { createSocialWeeklyProducerEvidenceRouter } from './socialWeeklyProducerEvidence.js';

test('producer evidence GET enforces actor tenant package and version without any writes', async context => {
  const f = await prepareWeeklyEnterpriseFactFixture(context), store = f.store, task = f.task;
  await store.create('users', { id: 'foreign', tenantId: 'other', role: 'admin' });
  await store.create('users', { id: 'disabled', tenantId: task.tenantId, role: 'admin', disabled: true });
  await store.create('social_weekly_operating_packages', { tenant_id: task.tenantId, program_id: task.programId, package_id: task.packageId, version: 2, payload: { ...f.pkg, version: 2 } });
  let tenantId: string | undefined = task.tenantId, userId: string | undefined = 'owner';
  const app = express(); app.use(express.json()); app.use((_req, res, next) => { res.locals.tenantId = tenantId; res.locals.userId = userId; next(); });
  app.use('/:programId/:packageId', createSocialWeeklyProducerEvidenceRouter(store));
  app.use('/formal', createSocialProgramsRouter(store, false));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); context.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`, path = `/${task.programId}/${task.packageId}`;
  let writes = 0; for (const method of ['create', 'update', 'delete'] as const) context.mock.method(store, method, async () => { writes++; throw Error('GET must not write'); });
  const mounted = await fetch(`${base}/formal/${task.programId}/operating-packages/${task.packageId}/producer-evidence?version=1`); assert.equal(mounted.status, 200); assert.deepEqual((await mounted.json()).items, { preproduction: [], metrics: [], templates: [] });
  for (const version of [1, 2]) {
    const response = await fetch(`${base}${path}?version=${version}`); assert.equal(response.status, 200); assert.deepEqual((await response.json()).items, { preproduction: [], metrics: [], templates: [] });
  }
  for (const query of ['version=01', 'version=bad', 'version=1&scan=true']) assert.equal((await fetch(`${base}${path}?${query}`)).status, 400);
  assert.equal((await fetch(`${base}${path}?version=3`)).status, 409);
  assert.equal((await fetch(`${base}/wrong/${task.packageId}?version=1`)).status, 409);
  for (const actor of ['foreign', 'disabled', 'missing']) { userId = actor; assert.equal((await fetch(`${base}${path}?version=1`)).status, 403); }
  userId = 'owner'; tenantId = 'other'; assert.equal((await fetch(`${base}${path}?version=1`)).status, 403);
  tenantId = task.tenantId; userId = undefined; assert.equal((await fetch(`${base}${path}?version=1`)).status, 401);
  userId = 'owner'; const invalid = await fetch(`${base}${path}/preproduction-authority`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packageVersion: 1, taskId: task.taskId, kind: 'discovery', expectedConsumerInputHash: 'bad' }) }); assert.equal(invalid.status, 400);
  assert.equal(writes, 0);
});

test('formal POST pins outline authority then weekly scan produces durable evidence; repeated execution and GET are read safe', async context => {
  const f = await prepareWeeklyEnterpriseFactFixture(context), store = f.store, task = f.task;
  task.schedule.stepKind = 'business_outline'; task.schedule.responsibleActor = 'business_agent'; task.workflowKind = 'readiness';
  task.scope = 'package'; task.accountId = null; task.publicationTaskId = null;
  await store.create('social_weekly_execution_tasks', { tenant_id: task.tenantId, program_id: task.programId, package_id: task.packageId, package_version: task.packageVersion, task_id: task.taskId, status: task.status, idempotency_key: task.idempotencyKey, payload: task });
  const app = express(); app.use(express.json()); app.use((_req,res,next)=>{res.locals.tenantId=task.tenantId;res.locals.userId='owner';next();}); app.use('/formal',createSocialProgramsRouter(store,false));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));context.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address();assert.ok(address&&typeof address==='object');const url=`http://127.0.0.1:${address.port}/formal/${task.programId}/operating-packages/${task.packageId}/producer-evidence`;
  const read=await (await fetch(`${url}?version=1`)).json();assert.equal(read.bindingOptions.length,1);
  const body={packageVersion:1,...read.bindingOptions[0]};
  for(let i=0;i<2;i++){const response=await fetch(`${url}/preproduction-authority`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200,await response.clone().text());}
  assert.equal((await store.list('social_weekly_preproduction_jobs')).totalItems,1);
  const {runSocialWeeklyExecutionScan}=await import('../runtime/socialWeeklyExecutionRuntime.js');const result=await runSocialWeeklyExecutionScan({dataStore:store,adapters:{},now:new Date('2026-10-12T00:00:00Z')});assert.equal(result.preproduction.succeeded,1);
  assert.equal((await runSocialWeeklyExecutionScan({dataStore:store,adapters:{},now:new Date('2026-10-12T00:00:00Z')})).preproduction.succeeded,0);
  let writes=0;for(const method of ['create','update','delete'] as const)context.mock.method(store,method,async()=>{writes++;throw Error('read only');});
  const response=await fetch(`${url}?version=1`);assert.equal(response.status,200);const evidence=await response.json();assert.equal(evidence.items.preproduction.length,1);assert.equal(evidence.items.preproduction[0].status,'succeeded');assert.ok(evidence.items.preproduction[0].resultRefs.some((r:{type:string})=>r.type==='business_content_goal'));assert.equal(writes,0);
});
