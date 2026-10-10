import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { prepareWeeklyEnterpriseFactFixture } from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import { ENTERPRISE_FACT_GAP } from '../runtime/weeklyEnterpriseFactSupplement.js';
import { materializeWeeklySupplementException } from '../runtime/weeklySupplementExceptionMaterializer.js';
import { createSocialWeeklySupplementRequestsRouter } from './socialWeeklySupplementRequests.js';

test('authenticated fact exceptions preserve exact consumer/version and never write on GET', async context => {
  const fixture = await prepareWeeklyEnterpriseFactFixture(context), store = fixture.store, task = fixture.task;
  task.status = 'blocked'; task.ownBlockingReasons = [ENTERPRISE_FACT_GAP];
  task.lastError = { code: ENTERPRISE_FACT_GAP, message: 'facts missing', retryable: false, occurredAt: new Date().toISOString() };
  await store.create('social_weekly_execution_tasks', { tenant_id:task.tenantId, program_id:task.programId, package_id:task.packageId, package_version:1, task_id:task.taskId, idempotency_key:task.idempotencyKey, status:task.status, payload:task });
  await store.create('users',{id:'foreign',tenantId:'foreign',role:'admin'});
  await store.create('social_weekly_operating_packages',{tenant_id:task.tenantId,program_id:task.programId,package_id:task.packageId,version:2,payload:{...fixture.pkg,version:2,status:'draft'}});
  await materializeWeeklySupplementException({store,task,gapCode:ENTERPRISE_FACT_GAP});
  let tenantId:string|undefined=task.tenantId,userId:string|undefined='owner';
  const app=express();app.use((_req,res,next)=>{res.locals.tenantId=tenantId;res.locals.userId=userId;next();});
  app.use('/:programId/:packageId',createSocialWeeklySupplementRequestsRouter(store));
  app.use((error:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(409).json({error:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));context.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address();assert.ok(address&&typeof address==='object');
  const base=`http://127.0.0.1:${address.port}`,path=`/${task.programId}/${task.packageId}/scheduler-exceptions`;
  let writes=0;context.mock.method(store,'create',async()=>{writes++;throw Error('GET_create');});context.mock.method(store,'update',async()=>{writes++;throw Error('GET_update');});context.mock.method(store,'delete',async()=>{writes++;throw Error('GET_delete');});
  for(let i=0;i<2;i++){const response=await fetch(`${base}${path}?version=1`);assert.equal(response.status,200);const body=await response.json();assert.equal(body.items.length,1);assert.equal(body.items[0].kind,'enterprise_facts');assert.equal(body.items[0].consumerTaskId,task.taskId);}
  const old=await fetch(`${base}${path}?version=2`);assert.equal(old.status,200);assert.deepEqual((await old.json()).items,[]);
  assert.equal((await fetch(`${base}${path}?version=3`)).status,409);
  assert.equal((await fetch(`${base}/wrong/${task.packageId}/scheduler-exceptions?version=1`)).status,409);
  userId='foreign';assert.equal((await fetch(`${base}${path}?version=1`)).status,403);
  tenantId='foreign';userId='owner';assert.equal((await fetch(`${base}${path}?version=1`)).status,403);
  tenantId=task.tenantId;userId=undefined;assert.equal((await fetch(`${base}${path}?version=1`)).status,401);
  assert.equal(writes,0);
});
