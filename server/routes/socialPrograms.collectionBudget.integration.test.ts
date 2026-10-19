import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {prepareWeeklyEnterpriseFactFixture} from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import {bindWeeklyPreproductionAuthority} from '../runtime/weeklyPreproductionProducer.js';
import {supplementConsumerHash} from '../socialPrograms/weeklySupplementRequests.js';
import {createSocialProgramsRouter} from './socialPrograms.js';
import {readWeeklyCollectionRuntimeCard} from '../socialPrograms/weeklyCollectionBudgetCard.js';

test('main authenticated social-program route exposes collection budget only for the persisted weekly blocker',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t);f.pkg.discoveryBudgetCny=5;
 const packageRow=(await f.store.list<Record<string,unknown>>('social_weekly_operating_packages',{where:{tenant_id:f.task.tenantId,program_id:f.task.programId,package_id:f.task.packageId,version:f.task.packageVersion},perPage:2})).items[0]!;
 await f.store.update('social_weekly_operating_packages',String(packageRow.id),{payload:structuredClone(f.pkg)});
 const task={...f.task,workflowKind:'readiness' as const,scope:'package' as const,accountId:null,publicationTaskId:null,inputSnapshot:{},status:'blocked' as const,ownBlockingReasons:['business_dispatch_required'],schedule:{...f.task.schedule,stepKind:'benchmark_collection' as const}};
 await f.store.create('social_weekly_execution_tasks',{tenant_id:task.tenantId,program_id:task.programId,package_id:task.packageId,package_version:task.packageVersion,task_id:task.taskId,idempotency_key:task.idempotencyKey,status:task.status,payload:task});
 const accountUrl='https://www.tiktok.com/@fixture_factory',payload={approval:{status:'approved',scopeVersion:3,approvedBy:'owner'},weeklyAccountRevision:{accountUrl,targetCount:5},discoveryBrief:{discoveryModes:['account'],weeklyAccountCollectionTarget:{accountUrl,targetCount:5},modePolicies:{account:{enabled:true}}}};
 await f.store.create('social_discovery_scopes',{id:'main-route-scope',tenant_id:task.tenantId,version:3,status:'active',created_by:'owner',payload});
 await f.store.create('competitor_accounts',{id:'main-route-account',tenantId:task.tenantId,platform:'tiktok',accountUrl});
 await bindWeeklyPreproductionAuthority({store:f.store,tenantId:task.tenantId,actorUserId:'owner',programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion,taskId:task.taskId,kind:'discovery',expectedConsumerInputHash:supplementConsumerHash(task),discovery:{scopeId:'main-route-scope',scopeVersion:3,requestedModes:['account']}});
 const app=express();app.use(express.json());app.use((_req,res,next)=>{Object.assign(res.locals,{tenantId:task.tenantId,userId:'owner'});next();});app.use('/api/overseas/social-programs',createSocialProgramsRouter(f.store,false));app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{const value=error as {status?:number;statusCode?:number;message?:string;code?:string};res.status(value.status??value.statusCode??500).json({error:value.code??value.message});});
 const server=app.listen(0);t.after(()=>server.close());const address=server.address();assert.ok(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}/api/overseas/social-programs/${task.programId}/operating-packages/${task.packageId}/collection-budget`;
 const beforeResponse=await fetch(`${url}?version=${task.packageVersion}`);assert.equal(beforeResponse.status,200);const before=(await beforeResponse.json() as {item:{contextHash:string;authorization:null;paidBlocker:string;permitsPaidCollection:false}}).item;
 assert.equal(before.paidBlocker,'weekly_preproduction_collection_budget_authorization_required');assert.equal(before.authorization,null);assert.equal(before.permitsPaidCollection,false);
 const runtime=(await (await fetch(url.replace('/collection-budget','/collection-runtime')+`?version=${task.packageVersion}`)).json() as {item:{status:string;publishedCostScenario:null;operationallyVerified:false}}).item;
 assert.equal(runtime.status,'needs_intervention');assert.equal(runtime.publishedCostScenario,null);assert.equal(runtime.operationallyVerified,false);
 const saved=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedPackageVersion:task.packageVersion,expectedContextHash:before.contextHash,totalLimitCny:5,perRunLimitCny:5})});assert.equal(saved.status,201,await saved.clone().text());
 const after=(await (await fetch(`${url}?version=${task.packageVersion}`)).json() as {item:{authorization:{authorizationId:string;totalLimitCny:number;perRunLimitCny:number;expiresAt:string};paidBlocker:string;permitsPaidCollection:false}}).item;
 assert.ok(after.authorization.authorizationId);assert.equal(after.authorization.totalLimitCny,5);assert.equal(after.authorization.perRunLimitCny,5);assert.ok(Number.isFinite(Date.parse(after.authorization.expiresAt)));
 assert.equal(after.paidBlocker,'weekly_preproduction_collection_cost_ceiling_unverified');assert.equal(after.permitsPaidCollection,false);
 const observedAt=new Date().toISOString();
 const projected=await readWeeklyCollectionRuntimeCard(f.store,{tenantId:task.tenantId,programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion},{
  env:{APIFY_TOKEN:'private-test-token'},costPreflightReader:async()=>null,
  probePpe:async()=>({actorId:'clockworks/tiktok-scraper',observedAt,actorResponseHash:'a'.repeat(64),accountResponseHash:'b'.repeat(64),pricingRecordHash:'c'.repeat(64),pricingStartedAt:observedAt,pricingModel:'PAY_PER_EVENT',accountTier:'BRONZE',eventPricesUsd:{result:.002,'video-download':.005},accountServiceRatesUsd:{datasetRead:4e-7,keyValueStoreRead:5e-6,keyValueStoreList:5e-5,datasetTimedStorageGbyteHour:.001,keyValueStoreTimedStorageGbyteHour:.001,externalDataTransferGbyte:.2},minimalMaxTotalChargeUsd:.5,actorPermissionLevel:'LIMITED_PERMISSIONS',agiPrepaidCompatibleByPermission:true}),
  probeLimits:async()=>({observedAt,responseHash:'d'.repeat(64),cycleStartAt:'2026-10-16T00:00:00.000Z',cycleEndAt:'2026-11-15T23:59:59.999Z',maxMonthlyUsageUsd:19,currentMonthlyUsageUsd:3.1,observedHeadroomUsd:15.9,dataRetentionDays:14,maxMonthlyExternalDataTransferGbytes:10,currentMonthlyExternalDataTransferGbytes:1,observedExternalDataTransferHeadroomGbytes:9,permitsWeeklyCollection:false}),
 });
 assert.deepEqual(projected.authenticatedProviderEvidence&&{tier:projected.authenticatedProviderEvidence.accountTier,eventNames:projected.authenticatedProviderEvidence.eventNames,minimum:projected.authenticatedProviderEvidence.minimalMaxTotalChargeUsd,headroom:projected.authenticatedProviderEvidence.observedHeadroomUsd,permit:projected.authenticatedProviderEvidence.permitsPaidCollection},{tier:'BRONZE',eventNames:['result','video-download'],minimum:.5,headroom:15.9,permit:false});
 assert.ok(!JSON.stringify(projected).includes('private-test-token'));
});
