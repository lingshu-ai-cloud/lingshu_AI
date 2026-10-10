import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFile} from 'node:fs/promises';
import {prepareDirectorG5Fixture,g5FixtureScope,passedDirectorChecks} from './socialDirectorG5ReviewService.fixture.js';
import {assertSocialMvpFinalCreativeAcceptance} from './socialDirectorG5ReviewService.js';
function frozen(f:Awaited<ReturnType<typeof prepareDirectorG5Fixture>>,ctx:{fileSha256:string}) {
 const artifact=f.tables.starter_social_content_artifacts![0]!;
 return {...g5FixtureScope,artifactVersion:String(artifact.version),artifactHash:String(artifact.content_hash),fileSha256:ctx.fileSha256};
}
test('MVP final signature is current assigned internal human, bound to frozen film and scope',async()=>{
 const f=await prepareDirectorG5Fixture();try{
 await f.g5.assign(g5FixtureScope,'owner',{reviewerUserId:'owner'});
 const ctx=await f.g5.context(g5FixtureScope,'owner'),identity=frozen(f,ctx);
 await f.g5.human(g5FixtureScope,'owner',{requestId:'mvp-human-signature-0001',expectedContextHash:ctx.contextHash,checks:passedDirectorChecks(ctx)});
 const signature=await assertSocialMvpFinalCreativeAcceptance(f.repository,identity);
 assert.equal(signature.reviewerUserId,'owner');assert.equal(signature.fileSha256,identity.fileSha256);
 assert.equal(signature.kind,'authenticated_internal_human_creative_acceptance');
 for(const drift of [{artifactVersion:'different'},{fileSha256:'f'.repeat(64)},{artifactHash:'e'.repeat(64)},{runId:'foreign-run'},{tenantId:'foreign'}])
  await assert.rejects(assertSocialMvpFinalCreativeAcceptance(f.repository,{...identity,...drift}));
 const user=f.tables.users!.find(u=>u.id==='owner')!;user.disabled=true;
 await assert.rejects(assertSocialMvpFinalCreativeAcceptance(f.repository,identity),/actor_forbidden/);
 user.disabled=false;await appendFile(f.local,'changed');
 await assert.rejects(assertSocialMvpFinalCreativeAcceptance(f.repository,identity),/integrity|bytes|changed|corrupt/);
 }finally{await f.cleanup();}
});
test('Agent preliminary pass cannot impersonate MVP final human signature',async()=>{
 const f=await prepareDirectorG5Fixture({runtime:{descriptor:()=>({configured:true,model:'controlled-director-vl',reservedCostCny:.25,inputPricePerMillion:1,outputPricePerMillion:2}),execute:async input=>({model:'controlled-director-vl',providerResponseId:'controlled-preliminary-pass',inputTokens:100,outputTokens:20,cacheTokens:0,checks:passedDirectorChecks(input.context),rawOutput:JSON.stringify({checks:passedDirectorChecks(input.context)})})}});
 try{
 let ctx=await f.g5.context(g5FixtureScope,'owner');
 await f.g5.authorizeExecution(g5FixtureScope,'owner',{expectedContextHash:ctx.contextHash,model:'controlled-director-vl',maximumCostCny:.5,budgetBucket:'content',purpose:'director_review'});
 ctx=await f.g5.context(g5FixtureScope,'owner');
 const review=await f.g5.agent(g5FixtureScope,'owner',{requestId:'mvp-agent-preliminary-0001',expectedContextHash:ctx.contextHash});
 assert.equal(review.item!.status,'passed');
 await assert.rejects(assertSocialMvpFinalCreativeAcceptance(f.repository,frozen(f,ctx)),/mvp_final_human_review_required/);
 }finally{await f.cleanup();}
});

import express from 'express';
import {createSocialDirectorG5ReviewRouter} from './socialDirectorG5ReviewRouter.js';
import {createServer} from 'node:http';
test('existing production G5 endpoint derives tenant and actor from authenticated locals and rejects invented humanConfirmed',async()=>{
 const f=await prepareDirectorG5Fixture();let server:ReturnType<typeof createServer>|undefined;
 try{
 await f.g5.assign(g5FixtureScope,'owner',{reviewerUserId:'owner'});
 const ctx=await f.g5.context(g5FixtureScope,'owner'),identity=frozen(f,ctx);
 await f.g5.human(g5FixtureScope,'owner',{requestId:'mvp-endpoint-human-0001',expectedContextHash:ctx.contextHash,checks:passedDirectorChecks(ctx)});
 const app=express();app.use(express.json());app.use((_req,res,next)=>{res.locals.tenantId='t';res.locals.userId='owner';next();});
 app.use('/tasks/:taskId/runs/:runId/artifacts/:artifactId/g5-reviews',createSocialDirectorG5ReviewRouter(f.g5));
 server=createServer(app);await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const url=`http://127.0.0.1:${address.port}/tasks/content/runs/run/artifacts/artifact/g5-reviews/mvp-final`;
 const input={artifactVersion:identity.artifactVersion,artifactHash:identity.artifactHash,fileSha256:identity.fileSha256};
 const post=(body:unknown)=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post({...input,humanConfirmed:true})).status,400);
 assert.equal((await post({...input,reviewerUserId:'invented'})).status,400);
 const accepted=await post(input);assert.equal(accepted.status,200);
 const data=await accepted.json() as {item:{reviewerUserId:string;tenantId:string}};
 assert.equal(data.item.reviewerUserId,'owner');assert.equal(data.item.tenantId,'t');
 f.tables.users!.find(u=>u.id==='owner')!.disabled=true;
 assert.equal((await post(input)).status,403);
 }finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await f.cleanup();}
});
