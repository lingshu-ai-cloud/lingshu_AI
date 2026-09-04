import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getWhatsAppCustomers, patchWhatsAppCustomer } from './historyImport.js';

const dataDir = path.join(process.cwd(), 'data');
const customersFile = path.join(dataDir, 'whatsapp-customers.json');
const interactionsFile = path.join(dataDir, 'whatsapp-interactions.json');
const pilotEventsFile = path.join(dataDir, 'sales-pilot-events.json');
const originalCustomers = fs.existsSync(customersFile) ? fs.readFileSync(customersFile) : null;
const originalInteractions = fs.existsSync(interactionsFile) ? fs.readFileSync(interactionsFile) : null;
const originalPilotEvents = fs.existsSync(pilotEventsFile) ? fs.readFileSync(pilotEventsFile) : null;

const restore = (file: string, value: Buffer | null) => {
  if (value) fs.writeFileSync(file, value);
  else if (fs.existsSync(file)) fs.unlinkSync(file);
};

try {
  fs.mkdirSync(dataDir, { recursive: true });
  const now = Date.now();
  fs.writeFileSync(customersFile, JSON.stringify([
    {
      id: 'wa_tenant_a_971500000001', tenantId: 'tenant_a', waNumber: '971500000001', name: 'Dubai Buyer', language: '英语', stage: 'inquiry', handlingMode: 'ai_draft', handlingReason: '待确认', intentScore: 80, lastActiveAt: now - 1_000, createdAt: new Date(now - 2_000).toISOString(), updatedAt: new Date(now - 1_000).toISOString(), source: 'whatsapp_from_youtube', hasUnread: true, tags: ['legacy-context'],
    },
    {
      id: 'wa_tenant_a_971500000001', tenantId: 'tenant_a', waNumber: '971500000001', name: 'Dubai Buyer Updated', stage: 'inquiry', handlingMode: 'ai_draft', handlingReason: '新状态', intentScore: 85, lastActiveAt: now, createdAt: new Date(now - 1_000).toISOString(), updatedAt: new Date(now).toISOString(), source: 'whatsapp_from_youtube', pendingDraft: 'Newer draft',
    },
    {
      id: 'wa_tenant_b_971500000002', tenantId: 'tenant_b', waNumber: '971500000002', name: 'Other Tenant', language: '英语', stage: 'inquiry', handlingMode: 'ai_draft', handlingReason: '待确认', intentScore: 50, lastActiveAt: now, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), source: 'whatsapp',
    },
    {
      id: 'wa_tenant_a_12025550123', tenantId: 'tenant_a', waNumber: '12025550123', name: 'Unknown Region', language: '英语', stage: 'inquiry', handlingMode: 'ai_draft', handlingReason: '待确认', intentScore: 40, lastActiveAt: now, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), source: 'unexpected-import-label',
    },
  ], null, 2));
  fs.writeFileSync(interactionsFile, JSON.stringify([
    { id: 'msg-a', tenantId: 'tenant_a', customerId: 'wa_tenant_a_971500000001', waNumber: '971500000001', type: 'msg_in', body: 'Hello', timestamp: now - 1_000, audit: { retained: true, source: 'older' } },
    { id: 'msg-a', tenantId: 'tenant_a', customerId: 'wa_tenant_a_971500000001', waNumber: '971500000001', type: 'msg_in', body: 'Hello updated', timestamp: now, audit: { source: 'newer' } },
  ], null, 2));

  const before = getWhatsAppCustomers('tenant_a');
  assert.equal(before.length, 2, 'tenant+customer id duplicates must collapse before segmentation');
  const dubai = before.find(item => item.id === 'wa_tenant_a_971500000001');
  assert.equal(dubai.name, 'Dubai Buyer Updated', 'the fresher duplicate must win');
  assert.equal(dubai.language, '英语', 'useful fields missing from the fresher duplicate must be retained');
  assert.deepEqual(dubai.tags, ['legacy-context'], 'older non-empty customer context must survive the merge');
  assert.equal(dubai.timeline.length, 1, 'tenant+interaction id duplicates must collapse in the customer timeline');
  assert.equal(dubai.timeline[0].body, 'Hello updated');
  assert.equal(dubai.timeline[0].audit.retained, true, 'interaction audit context must be merged without duplicate timeline entries');
  assert.equal(dubai.timeline[0].audit.source, 'newer');
  assert.equal(dubai.countryName, '阿联酋');
  assert.equal(dubai.timeZone, 'Asia/Dubai');
  assert.equal(dubai.timeZoneSource, 'phone_country_default');
  assert.notEqual(dubai.localTime, '未知');
  assert.equal(dubai.source, 'whatsapp_from_youtube');
  const northAmerica = before.find(item => item.id === 'wa_tenant_a_12025550123');
  assert.equal(northAmerica?.countryName, '北美（国家码默认）');
  assert.equal(northAmerica?.timeZone, 'America/New_York');
  assert.equal(northAmerica?.timeZoneSource, 'phone_country_default');
  assert.notEqual(northAmerica?.localTime, '未知');
  assert.equal(northAmerica?.source, 'whatsapp');

  const updated = patchWhatsAppCustomer({
    tenantId: 'tenant_a',
    customerId: 'wa_tenant_a_971500000001',
    patch: {
      language: '西语', languageLocked: true, handlingMode: 'human_needed', hasUnread: false,
      pendingDraft: 'Let me confirm the exact lead time for you.',
      orders: [{ id: 'QA-001', total: 'US $120.00', status: 'paid', createdAt: '2026-07-30' }],
    },
  });
  assert.ok(updated);
  const after = getWhatsAppCustomers('tenant_a').find(item => item.id === 'wa_tenant_a_971500000001');
  assert.equal(after.language, '西语');
  assert.equal(after.languageLocked, true);
  assert.equal(after.handlingMode, 'human_needed');
  assert.equal(after.hasUnread, false);
  assert.equal(after.pendingDraft, 'Let me confirm the exact lead time for you.');
  assert.deepEqual(after.orders.map((item: any) => item.id), ['QA-001']);
  const compacted = JSON.parse(fs.readFileSync(customersFile, 'utf8')) as Array<{ tenantId?: string; id?: string }>;
  assert.equal(compacted.filter(item => item.tenantId === 'tenant_a' && item.id === 'wa_tenant_a_971500000001').length, 1, 'the next customer write must compact legacy duplicates on disk');

  patchWhatsAppCustomer({ tenantId: 'tenant_a', customerId: 'wa_tenant_a_12025550123', patch: { timeZone: 'America/Los_Angeles' } });
  const preciseNorthAmerica = getWhatsAppCustomers('tenant_a').find(item => item.id === 'wa_tenant_a_12025550123');
  assert.equal(preciseNorthAmerica?.timeZone, 'America/Los_Angeles');
  assert.equal(preciseNorthAmerica?.timeZoneSource, 'customer_profile', 'a customer-profile override must supersede the phone-country default');
  assert.equal(after.stage, 'won');
  assert.equal(after.salesState.lifecycle.stage, 'closed');
  assert.equal(after.salesState.lifecycle.outcome, 'won');

  patchWhatsAppCustomer({ tenantId: 'tenant_a', customerId: 'wa_tenant_a_971500000001', patch: { pendingDraft: null } });
  assert.equal(getWhatsAppCustomers('tenant_a').find(item => item.id === 'wa_tenant_a_971500000001')?.pendingDraft, undefined);

  assert.equal(patchWhatsAppCustomer({ tenantId: 'tenant_a', customerId: 'wa_tenant_b_971500000002', patch: { language: '法语' } }), null);
  assert.equal(getWhatsAppCustomers('tenant_b')[0]?.language, '英语');
  console.log('WhatsApp customer profile persistence passed');
} finally {
  restore(customersFile, originalCustomers);
  restore(interactionsFile, originalInteractions);
  restore(pilotEventsFile, originalPilotEvents);
}
