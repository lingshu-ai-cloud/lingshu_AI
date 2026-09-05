import 'dotenv/config';
import {
  dispatchFollowupBatch,
  followupDispatchPreflightFacts,
  getTenantFollowupDispatchStatus,
  preflightFollowupBatchDispatch,
} from '../server/digitalEmployees/followupDispatchWorker.js';
import { getFollowupBatch, getFollowupBatchItems } from '../server/digitalEmployees/customerWorkflow.js';

const CONFIRMATION = 'SEND_TO_AUTHORIZED_TEST_RECIPIENT';

function required(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

function redactedNumber(value: string): string {
  const normalized = digits(value);
  if (normalized.length < 7) return 'invalid';
  return `${normalized.slice(0, 3)}***${normalized.slice(-4)}`;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('production_environment_not_allowed');
  if (required('WHATSAPP_E2E_CONFIRM') !== CONFIRMATION) throw new Error('explicit_test_recipient_confirmation_required');

  const tenantId = required('WHATSAPP_E2E_TENANT_ID');
  const batchId = required('WHATSAPP_E2E_BATCH_ID');
  const customerId = required('WHATSAPP_E2E_CUSTOMER_ID');
  const recipient = digits(required('WHATSAPP_E2E_RECIPIENT'));
  if (recipient.length < 7 || recipient.length > 15) throw new Error('invalid_e2e_recipient');

  const batch = await getFollowupBatch(tenantId, batchId);
  if (!batch) throw new Error('followup_batch_not_found');
  const before = await getFollowupBatchItems(tenantId, batchId);
  const candidates = before.filter(item => ['approved', 'retry_wait'].includes(item.status));
  if (!candidates.length) throw new Error('no_approved_e2e_recipient');
  if (candidates.some(item => digits(item.wa_number) !== recipient || item.customer_id !== customerId)) {
    throw new Error('batch_contains_non_allowlisted_recipient');
  }

  const channel = await getTenantFollowupDispatchStatus(tenantId);
  if (!channel.authorization.providerReady) throw new Error('whatsapp_provider_not_ready');
  if (!channel.authorization.manualFollowupSendAllowed) {
    throw new Error(`manual_send_not_authorized:${channel.authorization.reasons.join(',')}`);
  }

  const preflight = await preflightFollowupBatchDispatch(tenantId, batchId, { mode: 'manual' });
  if (!preflight.ready || preflight.eligible !== candidates.length) {
    throw new Error(`e2e_preflight_blocked:${followupDispatchPreflightFacts(preflight).join(';')}`);
  }

  const result = await dispatchFollowupBatch(tenantId, batchId, { mode: 'manual' });
  const after = await getFollowupBatchItems(tenantId, batchId);
  const verified = after.filter(item => (
    item.customer_id === customerId
    && digits(item.wa_number) === recipient
    && ['sent', 'delivered', 'read'].includes(item.status)
    && Boolean(String(item.provider_message_id || '').trim())
  ));
  if (result.sent !== candidates.length || result.partial || result.failed || verified.length !== candidates.length) {
    throw new Error(`real_send_receipt_verification_failed:${JSON.stringify({ result, verified: verified.length, expected: candidates.length })}`);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    tenantId,
    batchId,
    customerId,
    recipient: redactedNumber(recipient),
    accepted: verified.length,
    providerMessageIds: verified.map(item => item.provider_message_id),
    statuses: verified.map(item => item.status),
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
