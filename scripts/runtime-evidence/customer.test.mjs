import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { customerEvidenceSigningPayload, validateWhatsAppEvidence, validateMessengerEvidence } from './customer.mjs';
function fixture(channel) {
  const expected = {tenantId:'tenant',accountId:'account',version:2,accountHash:'a'.repeat(64),customerId:'buyer',recipientId:'12025550123',nativeAccountId:'12345678',wabaId:'waba'};
  const evidence = {channel,tenantId:'tenant',version:2,accountHash:expected.accountHash,capturedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),requestId:'request',requestStatus:'accepted',deliveryStatus:'delivered',historyWritebackPending:false,
    account:{tenantId:'tenant',accountId:'account',phoneNumberId:'12345678',wabaId:'waba',pageId:'12345678',providerAccountId:'12345678',status:channel==='whatsapp'?'active':'connected'},
    customer:{tenantId:'tenant',customerId:'buyer',recipientId:expected.recipientId,waNumber:expected.recipientId,pageId:'12345678',messengerUserId:expected.recipientId},
    providerReceipt:{messageId:'mid.private',recipientId:expected.recipientId,raw:channel==='whatsapp'?{messaging_product:'whatsapp',messages:[{id:'mid.private'}],contacts:[{wa_id:expected.recipientId}]}:{message_id:'mid.private',recipient_id:expected.recipientId}}};
  return {expected,evidence,dryRun:true};
}
for (const [channel,validate] of [['whatsapp',validateWhatsAppEvidence],['messenger',validateMessengerEvidence]]) {
  test(`${channel}: dry run and forged JSON cannot claim live verification`,()=>{
    const f=fixture(channel);assert.equal(validate(f).status,'missing');assert.equal(validate({...f,dryRun:false,trusted:true,signature:'forged'}).status,'missing');
    assert.equal(validate({}).status,'failed');
    const output=JSON.stringify(validate(f));for(const secret of ['12025550123','mid.private','buyer','12345678'])assert.equal(output.includes(secret),false);
  });
  test(`${channel}: scope, version, recipient, freshness and provider drift fail`,()=>{
    for(const field of ['tenantId','accountId','version','accountHash','customerId','recipientId','nativeAccountId']) {
      const f=fixture(channel);f.expected[field]=field==='version'?3:'foreign';assert.equal(validate(f).status,'failed',field);
    }
    const f=fixture(channel);f.evidence.providerReceipt.raw={};assert.equal(validate(f).status,'failed');
    f.evidence.expiresAt='2000-01-01';assert.equal(validate(f).status,'failed');
  });
  test(`${channel}: pinned collector signature binds receipt; dry run remains missing`,()=>{
    const old=process.env.CUSTOMER_EVIDENCE_TRUSTED_PUBLIC_KEY;
    const {publicKey,privateKey}=generateKeyPairSync('ed25519');
    process.env.CUSTOMER_EVIDENCE_TRUSTED_PUBLIC_KEY=publicKey.export({format:'pem',type:'spki'});
    try {
      const f=fixture(channel);f.signature=sign(null,customerEvidenceSigningPayload(f.evidence),privateKey).toString('base64');
      assert.equal(validate(f).status,'missing');f.dryRun=false;assert.equal(validate(f).status,'verified');assert.equal(validate({...f,mode:'dry-run'}).status,'missing');
      f.evidence.requestId='tampered';assert.equal(validate(f).status,'missing');
      const fake=generateKeyPairSync('ed25519');f.signature=sign(null,customerEvidenceSigningPayload(f.evidence),fake.privateKey).toString('base64');assert.equal(validate(f).status,'missing');
    } finally {if(old===undefined)delete process.env.CUSTOMER_EVIDENCE_TRUSTED_PUBLIC_KEY;else process.env.CUSTOMER_EVIDENCE_TRUSTED_PUBLIC_KEY=old;}
  });
}
