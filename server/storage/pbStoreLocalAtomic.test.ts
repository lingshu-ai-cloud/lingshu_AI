import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const directory=mkdtempSync(path.join(tmpdir(),'local-cas-test-'));
const storeUrl=new URL('./pbStore.ts',import.meta.url).href;
const authorityUrl=new URL('./dataAuthority.ts',import.meta.url).href;
function run(code:string):Promise<string>{return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx','--input-type=module','--eval',`const {pbStore}=await import(${JSON.stringify(storeUrl)});const {runWithDataAuthority}=await import(${JSON.stringify(authorityUrl)});await runWithDataAuthority('local',async()=>{${code}});`],{env:{...process.env,NODE_ENV:'test',ENABLE_LOCAL_DEV_FALLBACK:'true',LOCAL_STORE_DIR:directory},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',reject);child.on('exit',c=>c===0?resolve(output):reject(Error(output)));});}
test('local CAS and create arbitrate across independent Node processes without lost writes',async()=>{
 await run(`await pbStore.create('counters',{id:'count',revision:0});`);
 await Promise.all(Array.from({length:6},()=>run(`if(!await pbStore.supportsAtomicCompareAndSwap())throw Error('missing capability');for(let i=0;i<20;i++){for(;;){const row=await pbStore.getById('counters','count');if(await pbStore.compareAndSwap('counters','count',{revision:row.revision},{revision:row.revision+1}))break;}}`)));
 assert.equal(JSON.parse(readFileSync(path.join(directory,'counters.json'),'utf8'))[0].revision,120);
 const attempts=await Promise.all(Array.from({length:6},()=>run(`console.log(Boolean(await pbStore.create('unique',{id:'one'})));`)));assert.equal(attempts.filter(s=>s.trim()==='true').length,1);
});
test('corrupt local ledger is not silently replaced by a fresh empty collection',async()=>{writeFileSync(path.join(directory,'broken.json'),'{bad');await assert.rejects(run(`await pbStore.create('broken',{id:'one'});`),/SyntaxError/);assert.equal(readFileSync(path.join(directory,'broken.json'),'utf8'),'{bad');});
test('independent quota consumers atomically share exactly five execution slots and durable dispatches',async()=>{
 const quotaUrl=new URL('../socialPrograms/contentCreationQuota.ts',import.meta.url).href;
 const outcomes=await Promise.all(Array.from({length:10},(_,i)=>run(`const {createContentCreationQuotaService}=await import(${JSON.stringify(quotaUrl)});const q=createContentCreationQuotaService({store:pbStore,assertAtomicStore:async()=>{if(!await pbStore.supportsAtomicCompareAndSwap())throw Error('unsupported');},readReleaseSafety:async()=>({leaseActive:false,inFlight:false,paid:false,unknown:false}),verifyDelivery:async()=>false});try{await q.reserve({tenantId:'t',programId:'p',weekStart:'2026-10-12'},{commandId:'cmd-${i}',actorId:'test',reason:'cross process race'},{contentId:'content-${i}',entry:'workspace'});console.log('reserved');}catch(e){if(!String(e).includes('content_creation_quota_full'))throw e;console.log('full');}`)));
 assert.equal(outcomes.filter(s=>s.trim()==='reserved').length,5);
 const pool=JSON.parse(readFileSync(path.join(directory,'social_content_creation_quotas.json'),'utf8'))[0].payload;
 assert.equal(Object.keys(pool.orders).length,5);assert.equal(pool.outbox.length,5);assert.equal(pool.audit.length,5);
});
test.after(()=>rmSync(directory,{recursive:true,force:true}));
