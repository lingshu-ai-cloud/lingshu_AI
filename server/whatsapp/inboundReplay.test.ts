import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root=fs.realpathSync(process.cwd());
if(process.env.INBOUND_REPLAY_ISOLATED_ROOT!==root){
  const temporary=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'inbound-replay-')));
  try{
    for(const name of ['server','src','shared','desktop'])fs.cpSync(path.join(root,name),path.join(temporary,name),{recursive:true});
    fs.copyFileSync(path.join(root,'package.json'),path.join(temporary,'package.json'));
    fs.symlinkSync(path.join(root,'node_modules'),path.join(temporary,'node_modules'),'dir');
    const result=spawnSync(process.execPath,['--import','tsx','server/whatsapp/inboundReplay.test.ts'],{cwd:temporary,env:{PATH:process.env.PATH,HOME:temporary,INBOUND_REPLAY_ISOLATED_ROOT:temporary},encoding:'utf8',timeout:30000});
    process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');assert.equal(result.status,0,result.error?.message);
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}else{
  globalThis.fetch=async()=>{throw Error('No network in inbound replay test');};
  const {store}=await import('../storage/index.js');
  store.list=(async()=>({items:[],page:1,perPage:100,totalPages:0,totalItems:0})) as typeof store.list;
  store.create=(async(_c:string,p:any)=>({...p,id:'mirror-fixture'})) as typeof store.create;
  store.update=(async()=>true) as typeof store.update;
  const {handleMetaWebhook}=await import('./historyImport.js');
  const payload=(field='history')=>({entry:[{changes:[{field,value:{messages:[{id:'fixture-inbound-id',from:'15550000000',timestamp:'1788681600',text:{body:'Hello, I need a product catalog.'}}]}}]}]});
  await handleMetaWebhook('tenant-a',payload());
  const customersPath=path.join(root,'data/whatsapp-customers.json');
  const interactionsPath=path.join(root,'data/whatsapp-interactions.json');
  const customers=JSON.parse(fs.readFileSync(customersPath,'utf8'));
  customers[0].hasUnread=false;customers[0].todoCompletedAt='2026-09-06T10:00:00Z';customers[0].handlingMode='human_needed';
  fs.writeFileSync(customersPath,JSON.stringify(customers));
  const before=fs.readFileSync(customersPath,'utf8');
  await Promise.all([handleMetaWebhook('tenant-a',payload('messages')),handleMetaWebhook('tenant-a',payload('messages'))]);
  assert.equal(fs.readFileSync(customersPath,'utf8'),before,'duplicate provider event must not reopen completed tasks or change handling state');
  assert.equal(JSON.parse(fs.readFileSync(interactionsPath,'utf8')).filter((r:any)=>r.tenantId==='tenant-a'&&r.metaMessageId==='fixture-inbound-id').length,1);
  await handleMetaWebhook('tenant-b',payload());
  assert.equal(JSON.parse(fs.readFileSync(interactionsPath,'utf8')).filter((r:any)=>r.metaMessageId==='fixture-inbound-id').length,2,'dedupe must not cross tenants');
  console.log('Actual webhook replay: same-tenant duplicate/concurrent replay preserves completed inbox state; cross-tenant independent; isolated storage, no real send');
}
