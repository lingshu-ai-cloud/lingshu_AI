import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyEnterpriseFactFixture} from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import {readWeeklyExistingFactSource} from './weeklyExistingFactSource.js';
import {updateTenantEnterpriseProfile,enterpriseFactContentHash,verifyEnterpriseFactContent,readTenantEnterpriseProfileStrict} from '../routes/enterprise.js';
test('existing facts use persisted member-confirmed product source; never reconfirm or synthesize fallback identity',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t),before=await f.store.list('tenant_profiles');
 const source=await readWeeklyExistingFactSource(f.store,'tenant-a');
 assert.equal(source.ref.id,f.profile.factVersion!.id);assert.equal(source.sourceHash,f.profile.factVersion!.contentHash);
 assert.deepEqual(await f.store.list('tenant_profiles'),before);
 await assert.rejects(readWeeklyExistingFactSource(f.store,'foreign'),/可信版本/);
 const row=(await f.store.list<any>('tenant_profiles')).items[0]!;
 const changed=structuredClone(row.profile);changed.products.items[0].name='Unconfirmed replacement';
 await f.store.update('tenant_profiles',row.id,{profile:changed});
 await assert.rejects(readWeeklyExistingFactSource(f.store,'tenant-a'),{code:'weekly_existing_facts_hash_changed'});
 await f.store.update('tenant_profiles',row.id,{profile:{...row.profile,factVersion:{...row.profile.factVersion,confirmedBy:'legacy_migration'}}});
 await assert.rejects(readWeeklyExistingFactSource(f.store,'tenant-a'),/可信版本/);
});
test('onboarding undefined focusProducts is hashed as the persisted JSON shape on future saves',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t);
 await updateTenantEnterpriseProfile('tenant-a',{strategy:{focusProducts:undefined,aiAutonomy:'draft'}} as any,'owner');
 const row=(await f.store.list<any>('tenant_profiles')).items[0]!;
 // The memory fixture retains undefined, so enforce real JSON storage semantics.
 const persisted=JSON.parse(JSON.stringify(row.profile));
 assert.equal(Object.hasOwn(persisted.strategy,'focusProducts'),false);
 assert.equal(persisted.factVersion.contentHash,enterpriseFactContentHash(persisted));
 await f.store.update('tenant_profiles',row.id,{profile:persisted});
 assert.equal((await readWeeklyExistingFactSource(f.store,'tenant-a')).contentVerification.mode,'exact');
});
test('legacy omitted focusProducts replays the entire original hash without reconfirming or modifying facts',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t);
 const row=(await f.store.list<any>('tenant_profiles')).items[0]!;
 const old=structuredClone(row.profile);old.strategy.focusProducts=undefined;
 old.factVersion={...old.factVersion,contentHash:enterpriseFactContentHash(old)};
 const persisted=JSON.parse(JSON.stringify(old));
 await f.store.update('tenant_profiles',row.id,{profile:persisted});
 const before=await f.store.list('tenant_profiles');
 const source=await readWeeklyExistingFactSource(f.store,'tenant-a');
 assert.equal(source.sourceHash,old.factVersion.contentHash);
 assert.deepEqual(source.ref,{type:'enterprise_fact',id:old.factVersion.id,version:old.factVersion.revision});
 assert.equal(source.confirmedAt,old.factVersion.confirmedAt);
 assert.equal(source.contentVerification.mode,'legacy_json_omitted_focus_products');
 assert.deepEqual(source.contentVerification.omittedPaths,['strategy.focusProducts']);
 assert.deepEqual((await readTenantEnterpriseProfileStrict('tenant-a'))!.factVersion,old.factVersion);
 assert.deepEqual(await f.store.list('tenant_profiles'),before);
 for(const change of [
  (p:any)=>p.products.items[0].name='Different product',
  (p:any)=>p.company.name='Different company',
  (p:any)=>p.strategy.focusProducts='New selection',
 ]){
  const changed=structuredClone(persisted);change(changed);
  assert.equal(verifyEnterpriseFactContent(changed).verified,false);
  await f.store.update('tenant_profiles',row.id,{profile:changed});
  await assert.rejects(readWeeklyExistingFactSource(f.store,'tenant-a'),{code:'weekly_existing_facts_hash_changed'});
  assert.deepEqual((await readTenantEnterpriseProfileStrict('tenant-a'))!.factVersion,old.factVersion,'reads must not relabel changed bytes as confirmed');
 }
});
test('unrelated JSON omissions are not guessed or repaired',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t);
 const old=structuredClone(f.profile) as any;old.unknownBusinessFact=undefined;
 old.factVersion={...old.factVersion,contentHash:enterpriseFactContentHash(old)};
 const persisted=JSON.parse(JSON.stringify(old));
 assert.equal(verifyEnterpriseFactContent(persisted).verified,false);
});
test('profile save hashes only the persisted source, not stripped transient integrations',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t),before=await readWeeklyExistingFactSource(f.store,'tenant-a');
 await updateTenantEnterpriseProfile('tenant-a',{integrations:{untrustedTransient:'not a fact'}} as any,'owner');
 const row=(await f.store.list<any>('tenant_profiles')).items[0]!;
 assert.equal(row.profile.integrations,undefined);
 assert.equal(row.profile.factVersion.contentHash,enterpriseFactContentHash(row.profile));
 assert.deepEqual(await readWeeklyExistingFactSource(f.store,'tenant-a'),before);
});
