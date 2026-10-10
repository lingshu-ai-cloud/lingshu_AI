import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPublicationReception, type ReceptionBinding, type ReceptionCheckPorts } from './publicationReceptionReadiness.js';
import { resolveCustomerMessagingAuthorization } from '../digitalEmployees/customerMessagingPolicy.js';

const binding = (): ReceptionBinding => ({ tenantId: 'tenant', programId: 'program', packageId: 'package', packageVersion: 1, publicationId: 'video', cta: 'Contact us for specifications', enterpriseFactHash: 'facts-v1', targets: [{ id: 'contact', required: true, ownerId: 'salesperson', destination: { kind: 'messaging', channel: 'whatsapp', receptionMode: 'automatic' }, requiredDocumentUrls: ['https://example.test/spec.pdf'] }] });
const ports = (): ReceptionCheckPorts => ({ facts: async () => ({ contentHash: 'facts-v1', revision: 1, documentUrls: ['https://example.test/spec.pdf'] }), ownerExists: async () => true, messaging: async (tenantId, channel) => resolveCustomerMessagingAuthorization({ tenantId, channel, configVersion: 3, configActive: true, customerAgentEnabled: true, allowRealCustomerMessages: true, providerReady: true, backgroundWorkerEnabled: false }), probePublicUrl: async url => ({ accessible: true, checkedUrl: url, evidenceId: 'http-check-1' }) });

test('complete check carries exact publication, facts, channel configuration and probe evidence', async () => {
  const result = await checkPublicationReception(binding(), ports(), new Date('2026-10-09T00:00:00Z'));
  assert.equal(result.status, 'passed'); assert.equal(result.checkedAt, '2026-10-09T00:00:00.000Z');
  assert.equal(result.publicationId, 'video'); assert.equal(result.enterpriseFacts.contentHash, 'facts-v1');
  assert.deepEqual(result.results[0].evidence.messaging, { configVersion: 3, channel: 'whatsapp', providerReady: true, inboundAutoSendAllowed: true });
});
test('missing public probe never treats a saved specification URL as accessible', async () => {
  const p = ports(); delete p.probePublicUrl;
  const result = await checkPublicationReception(binding(), p);
  assert.equal(result.status, 'blocked'); assert.ok(result.results[0].reasons.includes('public_url_probe_unavailable'));
});
test('changed facts, missing owner and cross-tenant authorization fail independently', async () => {
  const p = ports(); p.facts = async () => ({ contentHash: 'new', revision: 2, documentUrls: [] }); p.ownerExists = async () => false;
  const original = p.messaging; p.messaging = async (_tenant, channel) => original('other-tenant', channel);
  const result = await checkPublicationReception(binding(), p);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.results[0].reasons, ['enterprise_facts_changed', 'reception_owner_missing', 'required_document_not_in_confirmed_facts', 'messaging_scope_mismatch']);
});
test('optional broken channel does not block a valid required channel; missing bindings cannot pass', async () => {
  const b = binding(); b.targets.push({ id: 'optional', required: false, ownerId: '', destination: { kind: 'url', url: 'http://127.0.0.1/' }, requiredDocumentUrls: [] });
  assert.equal((await checkPublicationReception(b, ports())).status, 'passed');
  b.targets = []; assert.equal((await checkPublicationReception(b, ports())).status, 'blocked');
});
test('duplicate targets and invalid clocks cannot emit completion evidence', async () => {
  const b = binding(); b.targets.push(b.targets[0]);
  await assert.rejects(checkPublicationReception(b, ports()), /identity_invalid/);
  await assert.rejects(checkPublicationReception(binding(), ports(), new Date('invalid')), /binding_invalid/);
});

test('manual reception needs connected channel and real owner, not automatic-send consent', async () => {
  const b = binding(); b.targets[0].destination = { kind: 'messaging', channel: 'whatsapp', receptionMode: 'human' };
  const p = ports(); const original = p.messaging; p.messaging = async (tenant, channel) => ({ ...await original(tenant, channel), inboundAutoSendAllowed: false });
  assert.equal((await checkPublicationReception(b, p)).status, 'passed');
  b.targets[0].destination.receptionMode = 'automatic';
  assert.equal((await checkPublicationReception(b, p)).status, 'blocked');
});
test('an applicable CTA requires at least one required target and binds package version', async () => {
  const b = binding(); const first = await checkPublicationReception(b, ports());
  b.packageVersion = 2; const second = await checkPublicationReception(b, ports());
  assert.notEqual(first.bindingHash, second.bindingHash); assert.equal(second.packageVersion, 2);
  b.targets[0].required = false; assert.equal((await checkPublicationReception(b, ports())).status, 'blocked');
});
test('draft reception cannot claim an inactive customer agent is available', async () => {
  const b = binding(); b.targets[0].destination = { kind: 'messaging', channel: 'whatsapp', receptionMode: 'draft' };
  const p = ports(); const original = p.messaging; p.messaging = async (tenant, channel) => ({ ...await original(tenant, channel), customerAgentEnabled: false });
  const result = await checkPublicationReception(b, p); assert.equal(result.status, 'blocked'); assert.ok(result.results[0].reasons.includes('messaging_draft_agent_not_ready'));
});
