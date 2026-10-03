import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { customerServicePolicyFromSettings, customerServiceStatus } from '../routes/enterprise.js';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const hour = 60 * 60 * 1000;
const now = Date.UTC(2026, 7, 10, 8, 0, 0);

const disabled = customerServicePolicyFromSettings(undefined, now);
assert.equal(disabled.enabled, false, 'intelligent customer service must default to off');
assert.equal(disabled.canAutoSend, false, 'a newly connected account must never auto-send by default');
assert.equal(disabled.shouldAskPartialAutoReply, false);

const firstDay = customerServicePolicyFromSettings({
  enabled: true,
  enabledAt: new Date(now).toISOString(),
  partialAutoReplyEnabled: false,
  partialAutoReplyDecision: 'pending',
}, now);
assert.equal(firstDay.observationDay, 1);
assert.equal(firstDay.remainingHours, 72);
assert.equal(firstDay.eligibleForPartialAutoReply, false);
assert.equal(firstDay.canAutoSend, false, 'the first three days must remain suggestion-only');

const almostReady = customerServicePolicyFromSettings({
  enabled: true,
  enabledAt: new Date(now - 71 * hour).toISOString(),
  partialAutoReplyEnabled: false,
  partialAutoReplyDecision: 'pending',
}, now);
assert.equal(almostReady.remainingHours, 1);
assert.equal(almostReady.eligibleForPartialAutoReply, false);

const readyToAsk = customerServicePolicyFromSettings({
  enabled: true,
  enabledAt: new Date(now - 72 * hour).toISOString(),
  partialAutoReplyEnabled: false,
  partialAutoReplyDecision: 'pending',
}, now);
assert.equal(readyToAsk.eligibleForPartialAutoReply, true);
assert.equal(readyToAsk.shouldAskPartialAutoReply, true, 'the user must be asked after three days');
assert.equal(readyToAsk.canAutoSend, false, 'elapsed time alone must never authorize direct replies');

const declined = customerServicePolicyFromSettings({
  enabled: true,
  enabledAt: new Date(now - 96 * hour).toISOString(),
  partialAutoReplyEnabled: false,
  partialAutoReplyDecision: 'declined',
}, now);
assert.equal(declined.shouldAskPartialAutoReply, false);
assert.equal(declined.canAutoSend, false);

const authorizedSettings = {
  enabled: true,
  enabledAt: new Date(now - 96 * hour).toISOString(),
  partialAutoReplyEnabled: true,
  partialAutoReplyDecision: 'enabled' as const,
};
const approvedFaq = Array.from({ length: 5 }, (_, index) => ({
  id: `faq-${index}`,
  question: `Question ${index}`,
  answer: `Answer ${index}`,
  approvedForAuto: true,
}));
assert.equal(customerServiceStatus({ customerService: authorizedSettings, faq: approvedFaq, strategy: { aiAutonomy: 'draft' } } as never, now).autoReplyReady, false, 'permission must not override a later draft-only choice');
assert.equal(customerServiceStatus({ customerService: authorizedSettings, faq: approvedFaq.slice(0, 4), strategy: { aiAutonomy: 'auto' } } as never, now).autoReplyReady, false, 'at least five approved FAQs remain required');
assert.equal(customerServiceStatus({ customerService: authorizedSettings, faq: approvedFaq, strategy: { aiAutonomy: 'auto' } } as never, now).autoReplyReady, true, 'only all safety gates together may enable limited direct replies');

const enterpriseRoutes = read('server/routes/enterprise.ts');
assert.match(enterpriseRoutes, /customerService:\s*\{ \.\.\.DEFAULT_CUSTOMER_SERVICE \}/, 'stored profiles must default the master switch to off');
assert.match(enterpriseRoutes, /CUSTOMER_SERVICE_OBSERVATION_MS = 3 \* 24 \* 60 \* 60 \* 1000/, 'the observation period must be server controlled');
assert.match(enterpriseRoutes, /enterpriseRouter\.patch\('\/customer-service\/status'[\s\S]*?enabledAt: now[\s\S]*?aiAutonomy: 'draft'/, 'enabling must start a server timestamp and force suggestion mode');
assert.match(enterpriseRoutes, /customerService: current\.customerService/, 'generic enterprise saves must not spoof the master-switch history');

const inbound = read('server/whatsapp/historyImport.ts');
assert.match(inbound, /if \(!servicePolicy\.enabled\)[\s\S]*?智能客服未开启[\s\S]*?return;/, 'inbound messages must stop before draft generation when the master switch is off');
assert.match(inbound, /customerServiceStatus\(profile\)\.autoReplyReady/, 'real inbound auto-send must require every safety gate');

const drafts = read('server/routes/draftReply.ts');
assert.match(drafts, /manualRequest = body\.manualRequest === true[\s\S]*?!customerServiceEnabled && !manualRequest[\s\S]*?customer_service_disabled/, 'automatic draft generation must stay disabled while explicit manual draft requests remain available');

const outbox = read('server/routes/customerSuggestions.ts');
assert.match(outbox, /req\.body\?\.auto === true[\s\S]*?customerServiceStatus[\s\S]*?!status\.autoReplyReady/, 'all automatic outbox sends must pass the activation gate');
assert.match(outbox, /get\('\/:id\/suggestions'[\s\S]*?conversation_suggestions_disabled/, 'customer suggestions must stay off when conversation suggestions are disabled');

const ui = read('src/components/ConversionPage.tsx');
assert.match(ui, /aria-label="智能客服总开关"/, 'the customer workbench must expose a clear master switch');
assert.match(ui, /manualRequest[\s\S]*?requestDraft\(selected, instruction, undefined, intent, true\)/, 'manual AI drafts must remain available even when automatic customer service is off');
assert.match(ui, /if \(!customerServiceStatus\?\.enabled\) return;/, 'the automatic draft effect must stop quietly without erasing a manually generated draft');
assert.doesNotMatch(ui, /if \(!customerServiceStatus\?\.enabled\) \{\s*setDraftSuggestion\(null\)/, 'disabled automatic service must not clear manual AI output');
assert.match(ui, /建议模式已经用了 3 天[\s\S]*?继续只看建议[\s\S]*?开放部分直接回复/, 'the three-day permission choice must be explicit');
assert.match(ui, /partialAutoReplyActive = Boolean\(customerServiceStatus\?\.autoReplyReady && autonomyLevel === 'auto'\)/, 'the UI must respect a later return to draft-only mode');
assert.doesNotMatch(ui, /if \(selected\.isMock\) return;/, 'administrator mock conversations must generate drafts through the same endpoint');
assert.match(ui, /setDraftSuggestion\(null\);[\s\S]*?setLastDraftKey\(''\);[\s\S]*?setInput\(''\);/, 'reselecting a customer must allow the latest buyer message to generate a fresh draft');

const mockCustomers = read('src/mocks/customerProfiles.ts');
assert.match(mockCustomers, /id: 'mock-lead-suzhou-vision'[\s\S]*?message\('lead-1', 'buyer'/, 'the reply lab must open with a realistic buyer message');
assert.match(read('src/hooks/useCustomers.ts'), /MOCK_STORAGE_KEY = 'lingshu:mock-customer-conversations:v5'/, 'existing mock storage must be refreshed for the account-specific foreign-trade reply lab');

console.log('customer service activation tests passed');
