import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { appendLocalFollowupPreviewMessage, readLocalFollowupPreviewCustomers, saveLocalFollowupPreviewDraft } from './localFollowupPreview.js';

test('selected local copies require the development tenant; only saved local receipts count and retries do not duplicate', async () => {
  const keys = ['NODE_ENV', 'LINGSHU_LISTEN_HOST', 'LOCAL_FOLLOWUP_PREVIEW_TENANT_ID'] as const;
  const original = keys.map(k => process.env[k]);
  const tenant = 'preview-tenant', customer = 'preview_followup_existing';
  const id = createHash('sha256').update(`local-followup:${tenant}:${customer}`).digest('hex').slice(0, 15);
  let row: Record_ = { id, tenant_id: tenant, customer_id: customer, payload: JSON.stringify({id:customer,tenantId:tenant,localFollowupPreview:true,timeline:[]}) };
  let fail = false;
  const store = {list:async()=>({items:[row],totalItems:1}),getById:async(_c:string,key:string)=>key===id?row:null,update:async(_c:string,_id:string,patch:Record<string,unknown>)=>{if(fail)return false;row={...row,...patch};return true;}} as unknown as DataStore;
  try {
    process.env.NODE_ENV='production'; process.env.LINGSHU_LISTEN_HOST='127.0.0.1';process.env.LOCAL_FOLLOWUP_PREVIEW_TENANT_ID=tenant;
    assert.deepEqual(await readLocalFollowupPreviewCustomers(tenant,store),[]);
    assert.equal(await appendLocalFollowupPreviewMessage(tenant,customer,'Hello','request-1',store),null);
    process.env.NODE_ENV='development';
    assert.deepEqual(await readLocalFollowupPreviewCustomers('other',store),[]);
    const first = (await readLocalFollowupPreviewCustomers(tenant,store))[0];
    assert.equal(first.isMock,true);assert.equal(first.isReal,false);assert.equal(first.source,'local_followup');
    await saveLocalFollowupPreviewDraft(tenant,customer,'Edited draft',store);
    assert.equal(JSON.parse(String(row.payload)).pendingDraft,'Edited draft');
    const receipt=await appendLocalFollowupPreviewMessage(tenant,customer,'Hello','request-1',store);
    assert.equal(receipt?.localPreviewReceipt,true);
    assert.deepEqual(await appendLocalFollowupPreviewMessage(tenant,customer,'Hello','request-1',store),receipt);
    assert.equal(JSON.parse(String(row.payload)).timeline.length,1);
    await assert.rejects(appendLocalFollowupPreviewMessage(tenant,customer,'Different','request-1',store),/conflict/);
    fail=true;
    await assert.rejects(appendLocalFollowupPreviewMessage(tenant,customer,'Second','request-2',store),/save_failed/);
    assert.equal(JSON.parse(String(row.payload)).timeline.length,1);
  } finally { keys.forEach((k,i)=>{if(original[i]===undefined)delete process.env[k];else process.env[k]=original[i];}); }
});
