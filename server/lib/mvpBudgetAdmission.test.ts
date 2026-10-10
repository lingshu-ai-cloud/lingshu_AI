import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { MvpBudgetAdmission, type MvpBudgetRecord } from './mvpBudgetAdmission.js';
import type { MvpExecutionScope } from '../../shared/mvpExecutionScope.js';
const scope: MvpExecutionScope = { tenantId:'t',taskId:'task',version:1,session:'B',accountId:'account',productId:'product',runId:'run',action:'generate_media',authority:'customer',expiresAt:'2099-01-01T00:00:00Z',revoked:false,provider:'ark',model:'seedance',shotIds:['hook'],authorizedBy:'owner',authorizationRef:'grant1',budgetPoolId:'B',budgetLimitCny:5 };
const request = { scope,tenantId:'t',taskId:'task',version:1,session:'B' as const,accountId:'account',productId:'product',runId:'run',action:'generate_media',provider:'ark',model:'seedance',shotId:'hook',estimatedCostCny:3,operationId:'op1',fingerprint:'a'.repeat(64) };
function fixture(t: { after: (fn:()=>void)=>void }, mutation: Partial<MvpBudgetRecord>={}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mvp-b-pool-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,createHash('sha256').update('B').digest('hex')+'.json');
 const record: MvpBudgetRecord={schemaVersion:1,id:'B',tenantId:'t',taskId:'task',session:'B',limitCny:5,authorizations:[scope,{...scope,version:2,authorizationRef:'grant2'}],pricing:{verifiedAccountPrice:true,checkedAt:'2026-01-01T00:00:00Z',validUntil:'2099-01-01T00:00:00Z',balanceCny:20,evidenceRef:'account-quote',operationQuotes:{['a'.repeat(64)]:{provider:'ark',model:'seedance',upperBoundCny:3}}},entries:{},...mutation};
 fs.writeFileSync(file,JSON.stringify(record));return {admission:new MvpBudgetAdmission(root),file};
}
test('atomic pool prevents parallel overspend and repeated operation does not spend twice',async t=>{
 const {admission,file}=fixture(t);
 const results=await Promise.allSettled([admission.reserve(request),admission.reserve({...request,operationId:'op2'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const entries=JSON.parse(fs.readFileSync(file,'utf8')).entries;
 const op=Object.keys(entries)[0];assert.equal(entries[op].amountCny,3);
 assert.equal((await admission.reserve({...request,operationId:op}))?.existing,true);
 assert.equal(Object.keys(JSON.parse(fs.readFileSync(file,'utf8')).entries).length,1);
});
test('version change cannot reset pool; altered input cannot reuse request; B cannot consume A',async t=>{
 const {admission}=fixture(t);await admission.reserve(request);
 await assert.rejects(admission.reserve({...request,scope:{...scope,version:2,authorizationRef:'grant2'},version:2,operationId:'next-version'}),/budget_exceeded/);
 await assert.rejects(admission.reserve({...request,fingerprint:'b'.repeat(64)}),/input_changed/);
 const {admission:a}=fixture(t,{session:'A'});await assert.rejects(a.reserve(request),/pool_scope_mismatch/);
});
test('missing pool, forged authorization and unknown price fail closed; unknown reservation remains held',async t=>{
 const {admission,file}=fixture(t,{pricing:{verifiedAccountPrice:false,checkedAt:'2026-01-01T00:00:00Z',validUntil:'2099-01-01T00:00:00Z',balanceCny:20,evidenceRef:'public-price-only',operationQuotes:{}}});
 await assert.rejects(admission.reserve(request),/price_or_balance_unverified/);
 await assert.rejects(admission.reserve({...request,scope:{...scope,authorizedBy:'director'}}),/not_server_recorded/);
 fs.unlinkSync(file);await assert.rejects(admission.reserve(request),/not_provisioned/);
 const {admission:b,file:bf}=fixture(t);await b.reserve(request);
 // A timeout does not invoke releaseRejected: durable reservation survives a new instance.
 assert.equal(JSON.parse(fs.readFileSync(bf,'utf8')).entries.op1.amountCny,3);
 await b.releaseRejected('B','op1');assert.equal(Object.keys(JSON.parse(fs.readFileSync(bf,'utf8')).entries).length,0);
});
test('quote must bind exact input and conservative upper bound, not merely a price flag',async t=>{
 const {admission}=fixture(t);
 await assert.rejects(admission.reserve({...request,estimatedCostCny:2}),/price_or_balance_unverified/);
 await assert.rejects(admission.reserve({...request,fingerprint:'c'.repeat(64)}),/price_or_balance_unverified/);
});
