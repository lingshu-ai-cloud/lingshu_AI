import assert from 'node:assert/strict';
import test from 'node:test';
import { socialProgramApi, SocialProgramRequestError } from './socialProgramApi.js';

async function transport(action: (calls: Array<{url:string;init:RequestInit|undefined}>) => Promise<void>, respond: (url:string,init?:RequestInit)=>Promise<Response>) {
  const previousFetch=globalThis.fetch,previousStorage=globalThis.localStorage;
  const calls:Array<{url:string;init:RequestInit|undefined}>=[];
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=> 'repair-test-token'}});
  globalThis.fetch=async(url,init)=>{calls.push({url:String(url),init});return respond(String(url),init);};
  try {await action(calls);} finally {globalThis.fetch=previousFetch;Object.defineProperty(globalThis,'localStorage',{configurable:true,value:previousStorage});}
}
const root='/api/overseas/social-programs/p%2Fa/operating-packages/w%2Fb/repair-cases/c%2Fc';
const caseHash='a'.repeat(64),previewHash='b'.repeat(64),quoteHash='c'.repeat(64);

test('repair capacity preview reads exact version and authenticated case without mutation',async()=>{
  await transport(async calls=>{
    const result=await socialProgramApi.previewTechnicalRepairCapacity('p/a','w/b',3,'c/c');
    assert.equal(result.caseRecordHash,caseHash);
    assert.equal(calls.length,1);assert.equal(calls[0]!.url,root+'/capacity-preview?version=3');
    assert.equal(calls[0]!.init?.method,undefined);assert.equal(calls[0]!.init?.body,undefined);
    assert.equal(new Headers(calls[0]!.init?.headers).get('Authorization'),'Bearer repair-test-token');
  },async()=>Response.json({item:{caseRecordHash:caseHash,preview:{previewHash},admission:null}}));
});

test('paid repair confirmation binds case, preview and quote but never implicitly starts',async()=>{
  await transport(async calls=>{
    const result=await socialProgramApi.confirmTechnicalRepairCapacity('p/a','w/b',3,'c/c',{
      expectedCaseRecordHash:caseHash,expectedPreviewHash:previewHash,expectedQuoteHash:quoteHash,authorizedMaximumCostCny:0.25,
    });
    assert.equal(result.state,'ready');assert.equal(calls.length,1);
    assert.equal(calls[0]!.url,root+'/confirm-capacity');assert.equal(calls[0]!.init?.method,'POST');
    assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)),{packageVersion:3,expectedCaseRecordHash:caseHash,
      expectedPreviewHash:previewHash,expectedQuoteHash:quoteHash,authorizedMaximumCostCny:0.25});
  },async()=>Response.json({item:{state:'ready',execution:null}}));
});

test('local repair confirmation sends explicit zero and omits external quote authority',async()=>{
  await transport(async calls=>{
    await socialProgramApi.confirmTechnicalRepairCapacity('p/a','w/b',3,'c/c',{
      expectedCaseRecordHash:caseHash,expectedPreviewHash:previewHash,authorizedMaximumCostCny:0,
    });
    assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)),{packageVersion:3,expectedCaseRecordHash:caseHash,
      expectedPreviewHash:previewHash,authorizedMaximumCostCny:0});assert.equal(calls.length,1);
  },async()=>Response.json({item:{state:'ready',execution:null}}));
});

test('explicit start sends only case confirmation reference and preserves actual execution identity',async()=>{
  const execution={operationId:'op',runId:'actual-run',jobId:'actual-job'};
  await transport(async calls=>{
    const result=await socialProgramApi.startTechnicalRepair('p/a','w/b',3,'c/c',caseHash);
    assert.deepEqual(result.execution,execution);assert.equal(calls.length,1);
    assert.equal(calls[0]!.url,root+'/start');assert.equal(calls[0]!.init?.method,'POST');
    assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)),{packageVersion:3,expectedCaseRecordHash:caseHash});
  },async()=>Response.json({item:{state:'running',execution}},{status:202}));
});

test('expired capacity rejection surfaces its error and sends no automatic retry or second start',async()=>{
  await transport(async calls=>{
    await assert.rejects(socialProgramApi.startTechnicalRepair('p/a','w/b',3,'c/c',caseHash),
      (error:unknown)=>error instanceof SocialProgramRequestError&&error.code==='weekly_repair_case_capacity_confirmation_expired');
    assert.equal(calls.length,1);
  },async()=>Response.json({error:'weekly_repair_case_capacity_confirmation_expired',message:'容量确认已过期，请重新排期。'},{status:409}));
});

test('lost start response is propagated without repeating paid admission',async()=>{
  await transport(async calls=>{
    await assert.rejects(socialProgramApi.startTechnicalRepair('p/a','w/b',3,'c/c',caseHash),/connection lost/);
    assert.equal(calls.length,1);
  },async()=>{throw new Error('connection lost');});
});

test('runtime input cannot override the selected package or add client execution authority',
  {todo:'生产 API 仍展开 input；需显式挑选允许字段'},async()=>{
  await transport(async calls=>{
    await socialProgramApi.confirmTechnicalRepairCapacity('p/a','w/b',3,'c/c',{
      expectedCaseRecordHash:caseHash,expectedPreviewHash:previewHash,authorizedMaximumCostCny:0,
      packageVersion:99,execution:{jobId:'forged-job'},confirmed:true,
    } as unknown as Parameters<typeof socialProgramApi.confirmTechnicalRepairCapacity>[4]);
    assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)),{packageVersion:3,expectedCaseRecordHash:caseHash,
      expectedPreviewHash:previewHash,authorizedMaximumCostCny:0});
  },async()=>Response.json({item:{state:'ready',execution:null}}));
});

test('malformed successful capacity response is rejected before reaching task-card state',
  {todo:'生产 API 未核验容量预览 item 结构'},async()=>{
  await transport(async()=>{
    await assert.rejects(socialProgramApi.previewTechnicalRepairCapacity('p/a','w/b',3,'c/c'));
  },async()=>Response.json({item:null}));
});
