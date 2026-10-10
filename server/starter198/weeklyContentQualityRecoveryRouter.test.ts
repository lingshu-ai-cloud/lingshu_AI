import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';
import {prepareWeeklyQualityRecoveryFixture} from '../socialPrograms/weeklyContentQualityRecovery.fixture.js';
import {createWeeklyContentQualityRecoveryRouter} from './weeklyContentQualityRecoveryRouter.js';

test('actual HTTP quality recovery uses auth identity, explicit original consumer and readonly lost-response receipts',async t=>{
 const f=await prepareWeeklyQualityRecoveryFixture();t.after(f.cleanup);
 f.tables.users!.push({id:'other-owner',tenantId:'t',role:'social_operator',active:true});
 const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.headers['x-user']){res.locals.userId=req.headers['x-user'];res.locals.tenantId=req.headers['x-tenant']??'t';}next();});
 app.use('/tasks/:taskId/runs/:runId/artifacts/:artifactId/quality-recovery',createWeeklyContentQualityRecoveryRouter(f.service));
 const server=app.listen(0);await new Promise<void>(resolve=>server.once('listening',resolve));t.after(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
 const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}/tasks/content/runs/run/artifacts/artifact/quality-recovery`;
 const headers={'x-user':'owner','content-type':'application/json'};
 const post=(body:unknown,extra:Record<string,string>={})=>fetch(base+'/resume',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
 assert.equal((await fetch(base)).status,401);assert.equal((await fetch(base,{headers:{...headers,'x-tenant':'foreign'}})).status,403);
 const before=await(await fetch(base,{headers})).json();assert.equal(before.item.consumers[0].resumeAvailable,false);
 await f.completeG5();const response=await fetch(base,{headers});assert.match(response.headers.get('cache-control')??'',/no-store/);const ready=await response.json();
 const input={executionTaskId:f.task.taskId,requestId:'actual-http-quality-recovery-0001',expectedContextHash:ready.item.consumers[0].contextHash};
 assert.equal((await post({...input,tenantId:'t'})).status,400);assert.equal((await post({...input,recoveredBy:'owner'})).status,400);assert.equal((await post({...input,expectedContextHash:'0'.repeat(64)})).status,409);
 assert.equal((await post(input,{'x-user':'other-owner'})).status,403);
 const resumed=await post(input);assert.equal(resumed.status,200,JSON.stringify(await resumed.clone().json()));const result=await resumed.json();assert.equal(result.task.status,'queued');assert.equal(result.currentSourceVerified,true);
 const recovered=await(await fetch(`${base}/requests/${input.requestId}?executionTaskId=${f.task.taskId}`,{headers})).json();assert.deepEqual(recovered.item,result.item);assert.equal(recovered.task.taskId,f.task.taskId);
 assert.deepEqual((await(await post(input)).json()).item,result.item);assert.equal(f.current().qualityRecoveries!.length,1);
 assert.equal((await fetch(`${base}/requests/${input.requestId}?executionTaskId=another-consumer`,{headers})).status,409);
 assert.equal((await fetch(base.replace('/run/','/wrong-run/'),{headers})).status,409);
 assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.social_publication_attempts?.length??0,0);
});
