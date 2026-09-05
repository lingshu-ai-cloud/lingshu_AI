import assert from 'node:assert/strict';
import fs from 'node:fs';

const inbound = fs.readFileSync('server/whatsapp/historyImport.ts', 'utf8');
const worker = fs.readFileSync('server/digitalEmployees/followupDispatchWorker.ts', 'utf8');
const routes = fs.readFileSync('server/routes/digitalEmployees.ts', 'utf8');
const enterpriseRoutes = fs.readFileSync('server/routes/enterprise.ts', 'utf8');
const customerRoutes = fs.readFileSync('server/routes/customerSuggestions.ts', 'utf8');

assert.match(inbound, /readCustomerMessagingAuthorization\(tenantId\)/, 'inbound customer service must read the digital employee tenant consent');
assert.match(inbound, /messagingAuthorization\.inboundAutoSendAllowed/, 'inbound real sends must fail closed when tenant consent or provider readiness is missing');
assert.match(inbound, /sendTenantWhatsAppTextWithReceipts/, 'inbound real sends must retain provider receipts');
assert.match(inbound, /providerMessageId:\s*(?:bridgeReceipts|sentReceipts)/, 'inbound audit evidence must contain the actual WhatsApp message id');
assert.match(worker, /authorization\.scheduledFollowupSendAllowed/, 'scheduled outreach must require tenant consent, provider readiness, and the environment worker capability');
assert.match(worker, /authorization\.manualFollowupSendAllowed/, 'manual dispatch must still require tenant consent and provider readiness');
assert.match(worker, /customer_message_send_not_authorized/, 'missing real-send authority must stop before provider dispatch');
assert.match(routes, /customerAgentEnabled[\s\S]*?customerService:\s*\{[\s\S]*?enabled:\s*customerAgentEnabled/, 'onboarding customer Agent selection must activate the real inbound service path');
assert.match(routes, /code\.startsWith\('customer_message_send_not_authorized:'\)/, 'policy denials must be returned as actionable conflicts, not fake provider failures');
assert.match(enterpriseRoutes, /autoReplyReady:\s*status\.autoReplyReady\s*&&\s*messagingAuthorization\.inboundAutoSendAllowed/, 'customer-service UI status must not claim auto reply readiness before real-send authorization and provider readiness');
assert.match(customerRoutes, /outboxId:\s*providerReceipts\[0\]\?\.messageId/, 'the customer workbench must return an actual provider message id instead of a fabricated outbox id');
assert.match(customerRoutes, /providerMessageIds:\s*providerReceipts\.map/, 'manual customer sends must expose real provider receipts to the UI');

console.log('customer messaging integration contract tests passed');
