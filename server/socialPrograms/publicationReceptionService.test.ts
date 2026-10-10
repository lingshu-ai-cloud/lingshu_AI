import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { savePublicationReceptionBinding, checkPublicationReceptionAdmission, RECEPTION_CHECKS, productionReceptionPorts } from './publicationReceptionService.js';
import type { ReceptionBinding, ReceptionCheckPorts } from './publicationReceptionReadiness.js';
import { resolveCustomerMessagingAuthorization } from '../digitalEmployees/customerMessagingPolicy.js';
import {prepareWeeklyG6Fixture} from '../starter198/socialWeeklyG6ReviewService.fixture.js';
const binding = (): ReceptionBinding => ({ tenantId: 'tenant', programId: 'program', packageId: 'package', packageVersion: 1, publicationId: 'publication', cta: 'Message us', enterpriseFactHash: 'facts1', targets: [{ id: 'consultation', required: true, ownerId: 'salesperson', destination: { kind: 'messaging', channel: 'whatsapp', receptionMode: 'human' }, requiredDocumentUrls: [] }] });
function fixture() {
  const rows = new Map<string, any>();
  const store = { getById: async (collection: string, id: string) => structuredClone(rows.get(`${collection}:${id}`) ?? null), create: async (collection: string, row: any) => { const key = `${collection}:${row.id}`; if (rows.has(key)) throw Error('unique constraint'); rows.set(key, structuredClone(row)); return structuredClone(row); } } as unknown as DataStore;
  return { rows, store };
}
function ports(): ReceptionCheckPorts { return { facts: async () => ({ contentHash: 'facts1', revision: 1, documentUrls: [] }), ownerExists: async () => true, messaging: async (tenantId, channel) => resolveCustomerMessagingAuthorization({ tenantId, channel, configActive: true, customerAgentEnabled: false, allowRealCustomerMessages: false, providerReady: true, backgroundWorkerEnabled: false }) }; }
test('concurrent identical saves converge; changed inputs and package versions stay immutable', async () => {
  const { store, rows } = fixture(); const b = binding();
  const saved = await Promise.all(Array.from({ length: 4 }, () => savePublicationReceptionBinding(store, b, 'user')));
  assert.equal(new Set(saved.map(row => row.bindingId)).size, 1); assert.equal(rows.size, 1);
  b.packageVersion = 2; const revised = await savePublicationReceptionBinding(store, b, 'user'); assert.notEqual(revised.bindingId, saved[0].bindingId); assert.equal(rows.size, 2);
});
test('admission performs a fresh check and persists each observation; old passes do not mask changed facts', async () => {
  const { store, rows } = fixture(); const b = binding(); const { bindingId } = await savePublicationReceptionBinding(store, b, 'user'); const p = ports();
  const args = { dataStore: store, scope: b, cta: b.cta, bindingId, required: true, ports: p };
  assert.equal((await checkPublicationReceptionAdmission(args)).status, 'passed');
  p.facts = async () => ({ contentHash: 'facts2', revision: 2, documentUrls: [] });
  assert.equal((await checkPublicationReceptionAdmission(args)).status, 'blocked');
  assert.equal([...rows.keys()].filter(key => key.startsWith(RECEPTION_CHECKS)).length, 2);
  assert.equal((await checkPublicationReceptionAdmission({ ...args, scope: { ...b, packageVersion: 2 } })).status, 'blocked');
  assert.equal((await checkPublicationReceptionAdmission({ ...args, cta: 'Different promise' })).status, 'blocked');
});
test('legacy opt-out is explicit; required plans without binding block', async () => {
  const { store } = fixture(); const b = binding();
  assert.equal((await checkPublicationReceptionAdmission({ dataStore: store, scope: b, cta: b.cta, required: true })).status, 'blocked');
  assert.equal((await checkPublicationReceptionAdmission({ dataStore: store, scope: b, cta: b.cta, required: false })).status, 'legacy_unconfigured');
});
test('production personnel lookup rejects absent, cross-tenant, disabled and unrecognized-role users', async () => {
  const { store, rows } = fixture(); const p = productionReceptionPorts(store);
  assert.equal(await p.ownerExists('tenant', 'sales'), false);
  for (const owner of [{ tenantId: 'other', role: 'admin' }, { tenantId: 'tenant', role: 'admin', disabled: true }, { tenantId: 'tenant', role: 'unknown' }]) { rows.set('users:sales', owner); assert.equal(await p.ownerExists('tenant', 'sales'), false); }
  rows.set('users:sales', { tenantId: 'tenant', role: 'customer_service' }); assert.equal(await p.ownerExists('tenant', 'sales'), true);
});
test('invalid targets cannot be saved and tampered persisted requirements cannot admit', async () => {
  const { store, rows } = fixture(); const b = binding(); b.targets[0].required = false;
  await assert.rejects(savePublicationReceptionBinding(store, b, 'user'), /targets_invalid/);
  b.targets[0].required = true; const saved = await savePublicationReceptionBinding(store, b, 'user');
  const row = [...rows.values()][0]; row.payload.targets[0].ownerId = 'different-person';
  assert.equal((await checkPublicationReceptionAdmission({ dataStore: store, scope: b, cta: b.cta, required: true, bindingId: saved.bindingId, ports: ports() })).status, 'blocked');
  row.payload = null;
  assert.equal((await checkPublicationReceptionAdmission({ dataStore: store, scope: b, cta: b.cta, required: true, bindingId: saved.bindingId, ports: ports() })).status, 'blocked');
  for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(savePublicationReceptionBinding(store, { ...b, packageVersion: version }, 'user'), /binding_invalid/);
  }
});

test('production reception facts and channel authorization use the supplied actual store and never a global fallback',async t=>{
 const f=await prepareWeeklyG6Fixture();t.after(f.cleanup);
 const p=productionReceptionPorts(f.store),pub=f.pkg.socialContentPackage.publicationTasks[0]!;
 const facts=await p.facts('t');assert.equal(facts.contentHash,f.profile.factVersion!.contentHash);
 assert.equal((await p.messaging('t','messenger')).providerReady,true);
 const admitted=await checkPublicationReceptionAdmission({dataStore:f.store,scope:{tenantId:'t',programId:f.pkg.programId,packageId:f.pkg.packageId,packageVersion:f.pkg.version,publicationId:pub.publicationTaskId},cta:pub.cta!,bindingId:pub.receptionRequirement!.bindingId,required:true});
 assert.equal(admitted.status,'passed');
 await assert.rejects(p.facts('foreign'),/confirmed_facts_unavailable/);
 f.tables.social_accounts=[];assert.equal((await p.messaging('t','messenger')).providerReady,false);
 f.profile.brand.tone='Changed real enterprise facts';await assert.rejects(p.facts('t'),/confirmed_facts_unavailable/);
});
