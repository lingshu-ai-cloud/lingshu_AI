import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { sendRecoveryFixture } from '../socialPrograms/weeklyCustomerSendRecovery.fixture.js';
import { bindWeeklyCustomerRun } from '../runtime/socialWeeklyCustomerBridge.js';
import { createSocialWeeklyNativeDispatchRouter } from './socialWeeklyNativeDispatch.js';
test('native dispatch HTTP uses actual bound scope and rejects identity, receipt and foreign-week overrides before sending', async () => {
  const f = sendRecoveryFixture();
  await bindWeeklyCustomerRun(f.store, {tenantId:'tenant',programId:'program',packageId:'week',packageVersion:1}, 'run', 'owner');
  const calls: unknown[] = []; let reads=0;
  const app=express(); app.use(express.json()); app.use((_req,res,next)=>{Object.assign(res.locals,{tenantId:'tenant',userId:'owner'});next();});
  app.use('/programs/:programId/weeks/:packageId/native',createSocialWeeklyNativeDispatchRouter(f.store,{
    sources:async(tenant,actor,run,scope)=>{reads++;assert.equal(tenant,'tenant');assert.equal(actor,'owner');assert.equal(run,'run');assert.equal(scope.packageId,'week');return [];},
    dispatch:async input=>{calls.push(input);return {messagesSent:0,status:'test_port'};},
  }));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  try {const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}/programs/program/weeks/week/native`;
    assert.equal((await fetch(base+'/sources?version=1&runId=run')).status,200);assert.equal(reads,1);assert.equal(calls.length,0);
    const body={packageVersion:1,runId:'run',batchId:'batch',itemId:'item',expectedBatchVersion:1,expectedItemHash:'actual-hash'};
    const post=(url:string,b:unknown)=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});
    for(const field of ['tenantId','actorUserId','providerMessageId','weeklyAuthority']) assert.equal((await post(base,{...body,[field]:'forged'})).status,400);
    assert.equal((await post(base.replace('/week/','/foreign/'),body)).status,409);
    assert.equal((await post(base,{...body,packageVersion:2})).status,409);assert.equal(calls.length,0);
    assert.equal((await post(base,body)).status,200);assert.deepEqual(calls,[{tenantId:'tenant',actorUserId:'owner',expectedScope:{programId:'program',packageId:'week',packageVersion:1,runId:'run'},batchId:'batch',itemId:'item',expectedBatchVersion:1,expectedItemHash:'actual-hash'}]);
  }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
