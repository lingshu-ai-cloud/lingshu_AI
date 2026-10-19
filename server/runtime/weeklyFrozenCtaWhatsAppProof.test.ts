import test from 'node:test';
import assert from 'node:assert/strict';
import type {DataStore} from '../storage/datastore.js';
import type {TenantPlatformAppRecord} from '../lib/tenantPlatformApps.js';
import {encryptSecret} from '../lib/tenantPlatformApps.js';
import {whatsappAssetAuthorityHash} from '../whatsapp/assetAuthority.js';
import {readLiveWeeklyWhatsAppCtaProof} from './weeklyFrozenCtaWhatsAppProof.js';

function fixture(){
  const row:TenantPlatformAppRecord={id:'app',tenant_id:'tenant',platform:'meta',status:'active',app_id:'meta-app',app_secret:encryptSecret('signing-secret'),access_token:encryptSecret('access-token'),waba_id:'waba',phone_number_id:'phone',wa_public_number:'+8619653282176'};
  row.last_checklist=JSON.stringify({whatsappAssetProof:{authorityHash:whatsappAssetAuthorityHash(row),verifiedAt:new Date().toISOString()}});
  const store={getById:async(_collection:string,id:string)=>id===row.id?row:null} as unknown as DataStore;
  let listCalls=0,getCalls=0;
  const provider={listPhoneNumbers:async()=>{listCalls++;return{data:[{id:'phone'}]};},getPhoneNumber:async()=>{getCalls++;return{id:'phone',display_phone_number:'+86 196 5328 2176'};}};
  return{row,store,provider,calls:()=>({listCalls,getCalls})};
}

test('live Meta number and WABA membership produce a number-only proof',async()=>{
  const f=fixture();
  const proof=await readLiveWeeklyWhatsAppCtaProof({store:f.store,tenantId:'tenant',accountId:'app',expectedPublicNumber:'+8619653282176',provider:f.provider});
  assert.equal(proof.publicNumber,'8619653282176');
  assert.equal(proof.phoneNumberId,'phone');
  assert.equal(proof.kind,'meta_whatsapp_live_number.v1');
  assert.equal(f.calls().getCalls,1);
  assert.equal(JSON.stringify(proof).includes('access-token'),false);
});

test('stored number, local checklist and an ordinary URL cannot replace live Meta proof',async()=>{
  const f=fixture();
  await assert.rejects(readLiveWeeklyWhatsAppCtaProof({store:f.store,tenantId:'tenant',accountId:'app',expectedPublicNumber:'+8619653282177',provider:f.provider}),/number_changed/);
  assert.deepEqual(f.calls(),{listCalls:0,getCalls:0});
  await assert.rejects(readLiveWeeklyWhatsAppCtaProof({store:f.store,tenantId:'tenant',accountId:'app',expectedPublicNumber:'+8619653282176',provider:{...f.provider,getPhoneNumber:async()=>({id:'phone',display_phone_number:'+8619653282177'})}}),/provider_number_invalid/);
  await assert.rejects(readLiveWeeklyWhatsAppCtaProof({store:f.store,tenantId:'tenant',accountId:'app',expectedPublicNumber:'+8619653282176',provider:{...f.provider,listPhoneNumbers:async()=>({data:[{id:'other'}]})}}),/membership_invalid/);
});

test('revoked or cross-tenant account and drift during provider read fail closed',async()=>{
  const f=fixture();
  await assert.rejects(readLiveWeeklyWhatsAppCtaProof({store:f.store,tenantId:'foreign',accountId:'app',expectedPublicNumber:'+8619653282176',provider:f.provider}));
  f.row.status='error';
  await assert.rejects(readLiveWeeklyWhatsAppCtaProof({store:f.store,tenantId:'tenant',accountId:'app',expectedPublicNumber:'+8619653282176',provider:f.provider}));
  f.row.status='active';
  await assert.rejects(readLiveWeeklyWhatsAppCtaProof({store:f.store,tenantId:'tenant',accountId:'app',expectedPublicNumber:'+8619653282176',provider:{...f.provider,getPhoneNumber:async()=>{f.row.wa_public_number='8619653282177';return{id:'phone',display_phone_number:'+8619653282176'};}}}),/account_changed/);
});
