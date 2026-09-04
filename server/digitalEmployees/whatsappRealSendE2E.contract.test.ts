import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('scripts/verify-whatsapp-real-send.ts', 'utf8');

assert.match(source, /NODE_ENV === 'production'/, 'real-send verification must refuse production by default');
assert.match(source, /SEND_TO_AUTHORIZED_TEST_RECIPIENT/, 'real-send verification must require a deliberate confirmation phrase');
for (const variable of ['WHATSAPP_E2E_TENANT_ID', 'WHATSAPP_E2E_BATCH_ID', 'WHATSAPP_E2E_CUSTOMER_ID', 'WHATSAPP_E2E_RECIPIENT']) {
  assert.match(source, new RegExp(variable), `${variable} must be explicitly supplied`);
}
assert.match(source, /batch_contains_non_allowlisted_recipient/, 'a mixed-recipient batch must fail closed');
assert.match(source, /preflightFollowupBatchDispatch/, 'the real provider call must be preceded by the normal read-only preflight');
assert.match(source, /provider_message_id/, 'success must require the real provider receipt id');
assert.match(source, /result\.partial \|\| result\.failed/, 'partial or failed delivery must never pass the E2E verification');

console.log('WhatsApp real-send E2E safety contract passed');
