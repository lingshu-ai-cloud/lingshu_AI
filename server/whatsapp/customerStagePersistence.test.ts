import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getWhatsAppCustomers, recomputeWhatsAppCustomerStages } from './historyImport.js';

const dataDir = path.join(process.cwd(), 'data');
const customersFile = path.join(dataDir, 'whatsapp-customers.json');
const interactionsFile = path.join(dataDir, 'whatsapp-interactions.json');
const originalCustomers = fs.existsSync(customersFile) ? fs.readFileSync(customersFile) : null;
const originalInteractions = fs.existsSync(interactionsFile) ? fs.readFileSync(interactionsFile) : null;
const DAY_MS = 86_400_000;

const restore = (file: string, value: Buffer | null) => {
  if (value) fs.writeFileSync(file, value);
  else if (fs.existsSync(file)) fs.unlinkSync(file);
};

try {
  fs.mkdirSync(dataDir, { recursive: true });
  const now = Date.parse('2026-08-23T00:00:00.000Z');
  fs.writeFileSync(customersFile, JSON.stringify([
    {
      id: 'wa_tenant_stage_971500000011', tenantId: 'tenant_stage', waNumber: '971500000011', name: 'Quoted Buyer', language: '英语', stage: 'quoted', handlingMode: 'ai_draft', handlingReason: '已报价', intentScore: 80, lastActiveAt: now - 90 * DAY_MS, createdAt: new Date(now - 100 * DAY_MS).toISOString(), updatedAt: new Date(now - 90 * DAY_MS).toISOString(),
    },
    {
      id: 'wa_tenant_stage_971500000012', tenantId: 'tenant_stage', waNumber: '971500000012', name: 'Early Buyer', language: '英语', stage: 'inquiry', handlingMode: 'ai_draft', handlingReason: '待确认', intentScore: 50, lastActiveAt: now - 45 * DAY_MS, createdAt: new Date(now - 50 * DAY_MS).toISOString(), updatedAt: new Date(now - 45 * DAY_MS).toISOString(),
    },
  ], null, 2));
  fs.writeFileSync(interactionsFile, '[]');

  assert.equal(recomputeWhatsAppCustomerStages(now), 2);
  const items = getWhatsAppCustomers('tenant_stage');
  const quoted = items.find(item => item.name === 'Quoted Buyer');
  const early = items.find(item => item.name === 'Early Buyer');

  assert.equal(quoted.stage, 'quoted', '沉默状态不能覆盖报价里程碑');
  assert.equal(quoted.salesState.lifecycle.stage, 'proposal_quote');
  assert.equal(quoted.salesState.engagement.status, 'dormant_60d');
  assert.equal(early.stage, 'silent30');
  assert.equal(early.salesState.lifecycle.stage, 'discovery_qualification');
  assert.equal(early.salesState.engagement.status, 'dormant_30d');
  console.log('WhatsApp lifecycle and engagement persistence passed');
} finally {
  restore(customersFile, originalCustomers);
  restore(interactionsFile, originalInteractions);
}
