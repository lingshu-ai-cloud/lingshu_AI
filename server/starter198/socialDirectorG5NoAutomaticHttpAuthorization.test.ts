import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {prepareDirectorG5Fixture,g5FixtureScope} from './socialDirectorG5ReviewService.fixture.js';
import {createSocialDirectorG5ReviewRouter} from './socialDirectorG5ReviewRouter.js';

test('authenticated G5 HTTP request cannot mint weekly production authorization',async()=>{
 let providerCalls=0;
 const f=await prepareDirectorG5Fixture({runtime:{descriptor:()=>({configured:true,model:'controlled-director-vl',reservedCostCny:.25,inputPricePerMillion:1,outputPricePerMillion:2}),execute:async()=>{providerCalls++;throw Error('unpermitted provider call');}}});
 const app=express();app.use(express.json());app.use((_req,res,next)=>{res.locals.tenantId='t';res.locals.userId='owner';next();});
 app.use('/tasks/:taskId/runs/:runId/artifacts/:artifactId/g5-reviews',createSocialDirectorG5ReviewRouter(f.g5));
 const server=app.listen(0);await new Promise<void>(resolve=>server.once('listening',resolve));
 try{
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const context=await f.g5.context(g5FixtureScope,'owner');
  const response=await fetch(`http://127.0.0.1:${address.port}/tasks/content/runs/run/artifacts/artifact/g5-reviews/agent`,{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:'http-no-auto-auth-0001',expectedContextHash:context.contextHash})});
  assert.equal(response.status,409);
  assert.equal((await response.json()).error,'scene_g5_agent_execution_not_permitted');
  assert.equal(providerCalls,0);
  assert.equal(f.tables.starter_social_director_g5_reviews?.filter(row=>row.kind==='execution_authorization').length??0,0);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await f.cleanup();}
});
