import test from 'node:test';
import assert from 'node:assert/strict';
import {socialProgramApi,SocialProgramRequestError} from './socialProgramApi.js';

const h='a'.repeat(64),scope={programId:'p/a',packageId:'w/b',version:4,caseId:'c/c'};
const root='/api/overseas/social-programs/p%2Fa/operating-packages/w%2Fb/repair-cases/c%2Fc/creative-execution';
const repair=(state:string)=>({kind:'creative_revision',programId:'p/a',packageId:'w/b',packageVersion:4,caseId:'c/c',state,recordHash:h});
async function mocked(fn:(calls:{url:string;init?:RequestInit}[])=>Promise<void>,response:(url:string,init?:RequestInit)=>Response){const old=globalThis.fetch,calls:{url:string;init?:RequestInit}[]=[];Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=> 'creative-token'}});globalThis.fetch=async(input,init)=>{const url=String(input);calls.push({url,init});return response(url,init);};try{await fn(calls);}finally{globalThis.fetch=old;}}

test('creative capacity preview uses scoped GET and rejects a foreign case response',async()=>{
 await mocked(async calls=>{const item=await socialProgramApi.previewCreativeRepairCapacity(scope.programId,scope.packageId,scope.version,scope.caseId);assert.equal(item.caseId,scope.caseId);assert.equal(calls[0]!.url,`${root}/capacity-preview?version=4`);assert.equal(calls[0]!.init?.method,undefined);assert.equal(new Headers(calls[0]!.init?.headers).get('Authorization'),'Bearer creative-token');},()=>Response.json({item:{caseId:'c/c',caseRecordHash:h,configurationHash:h,previewHash:h,authorityHash:h,estimatedDurationMinutes:30,maximumCostCny:12,localOnly:true,quoteHash:null,availableUntil:'2026-10-12T08:00:00Z'}}));
 await mocked(async()=>assert.rejects(()=>socialProgramApi.previewCreativeRepairCapacity(scope.programId,scope.packageId,scope.version,scope.caseId),SocialProgramRequestError),()=>Response.json({item:{caseId:'foreign',caseRecordHash:h,configurationHash:h,previewHash:h,authorityHash:h,estimatedDurationMinutes:30,maximumCostCny:12,localOnly:true,quoteHash:null,availableUntil:'2026-10-12T08:00:00Z'}}));
});

test('creative confirmation sends only frozen authority fields and validates scoped response',async()=>{
 await mocked(async calls=>{await socialProgramApi.confirmCreativeRepairCapacity(scope.programId,scope.packageId,scope.version,scope.caseId,{expectedCaseRecordHash:h,expectedConfigurationHash:h,expectedPreviewHash:h,expectedAuthorityHash:h,expectedQuoteHash:h,authorizedMaximumCostCny:9});assert.equal(calls[0]!.url,`${root}/confirm-capacity`);assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)),{packageVersion:4,expectedCaseRecordHash:h,expectedConfigurationHash:h,expectedPreviewHash:h,expectedAuthorityHash:h,expectedQuoteHash:h,authorizedMaximumCostCny:9});},()=>Response.json({item:repair('ready')}));
 await mocked(async()=>assert.rejects(()=>socialProgramApi.confirmCreativeRepairCapacity(scope.programId,scope.packageId,scope.version,scope.caseId,{expectedCaseRecordHash:h,expectedConfigurationHash:h,expectedPreviewHash:h,expectedAuthorityHash:h,authorizedMaximumCostCny:0}),SocialProgramRequestError),()=>Response.json({item:{...repair('ready'),packageVersion:5}}));
});

test('creative start, reconcile and audit have distinct explicit commands',async()=>{
 await mocked(async calls=>{await socialProgramApi.startCreativeRepair(scope.programId,scope.packageId,scope.version,scope.caseId,h);await socialProgramApi.reconcileCreativeRepair(scope.programId,scope.packageId,scope.version,scope.caseId);await socialProgramApi.auditCreativeRepair(scope.programId,scope.packageId,scope.version,scope.caseId);assert.deepEqual(calls.map(c=>[c.url,JSON.parse(String(c.init?.body))]),[[`${root}/start`,{packageVersion:4,expectedCaseRecordHash:h}],[`${root}/reconcile`,{packageVersion:4}],[`${root}/audit`,{packageVersion:4}]]);},url=>Response.json({item:repair(url.endsWith('/start')?'running':url.endsWith('/audit')?'resolved':'awaiting_audit')}));
});

test('creative mutations reject missing, technical or incompatible states',async()=>{
 for(const item of [null,{...repair('ready'),kind:'technical_rework'},repair('awaiting_capacity')])await mocked(async()=>assert.rejects(()=>socialProgramApi.startCreativeRepair(scope.programId,scope.packageId,scope.version,scope.caseId,h),SocialProgramRequestError),()=>Response.json({item}));
});
