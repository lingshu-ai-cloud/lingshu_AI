import { verify } from 'node:crypto';

const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = value => typeof value === 'string' && value.trim().length > 0;
const version = value => Number.isSafeInteger(value) && value > 0;
// Deterministic signed envelope; no supplied trust flag or supplied public key is authoritative.
export function customerEvidenceSigningPayload(evidence) {
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return Buffer.from(JSON.stringify(canonical(evidence)));
}
function validate(input, channel) {
  const envelope = object(input), evidence = object(envelope.evidence), expected = object(envelope.expected);
  const account = object(evidence.account), customer = object(evidence.customer), receipt = object(evidence.providerReceipt);
  const raw = object(receipt.raw), checks = [];
  const check = (code, passed) => checks.push({ code, passed: Boolean(passed) });
  check('channel_matches', evidence.channel === channel);
  check('tenant_matches', text(expected.tenantId) && evidence.tenantId === expected.tenantId && account.tenantId === expected.tenantId && customer.tenantId === expected.tenantId);
  check('account_matches', text(expected.accountId) && account.accountId === expected.accountId);
  // version is the evidence authority revision, not a fabricated social_accounts database field.
  check('authority_version_matches', version(expected.version) && evidence.version === expected.version);
  check('account_authority_hash_matches', /^[a-f0-9]{64}$/.test(expected.accountHash ?? '') && evidence.accountHash === expected.accountHash);
  check('customer_matches', text(expected.customerId) && customer.customerId === expected.customerId);
  check('recipient_matches', text(expected.recipientId) && customer.recipientId === expected.recipientId && receipt.recipientId === expected.recipientId);
  const nativeId = channel === 'whatsapp' ? account.phoneNumberId : account.pageId;
  check('native_account_matches', text(expected.nativeAccountId) && nativeId === expected.nativeAccountId);
  check('account_live', account.status === (channel === 'whatsapp' ? 'active' : 'connected') && account.mock !== true && account.synthetic !== true);
  check('provider_message_id_present', text(receipt.messageId));
  if (channel === 'whatsapp') {
    check('whatsapp_recipient_format', /^[1-9][0-9]{6,14}$/.test(expected.recipientId ?? '') && customer.waNumber === expected.recipientId);
    check('whatsapp_waba_matches', text(expected.wabaId) && account.wabaId === expected.wabaId);
    check('provider_raw_matches', raw.messaging_product === 'whatsapp' && raw.messages?.[0]?.id === receipt.messageId && raw.contacts?.[0]?.wa_id === expected.recipientId);
  } else {
    check('messenger_page_recipient_format', /^[0-9]+$/.test(expected.nativeAccountId ?? '') && /^[0-9]+$/.test(expected.recipientId ?? '') && customer.pageId === nativeId && customer.messengerUserId === expected.recipientId && account.providerAccountId === nativeId);
    check('provider_raw_matches', raw.message_id === receipt.messageId && raw.recipient_id === expected.recipientId);
  }
  const now = Date.now(), captured = Date.parse(evidence.capturedAt), expires = Date.parse(evidence.expiresAt);
  check('fresh_evidence', Number.isFinite(captured) && Number.isFinite(expires) && captured <= now && captured >= now - 86400000 && expires > now && expires <= captured + 86400000);
  check('durable_receipt_matches', text(evidence.requestId) && evidence.requestStatus === 'accepted' && ['delivered', 'read'].includes(evidence.deliveryStatus) && evidence.historyWritebackPending === false);
  const contractPassed = checks.every(c => c.passed);
  const publicKey = process.env.CUSTOMER_EVIDENCE_TRUSTED_PUBLIC_KEY;
  let trusted = false;
  if (publicKey && text(envelope.signature)) {
    try { trusted = verify(null, customerEvidenceSigningPayload(evidence), publicKey, Buffer.from(envelope.signature, 'base64')); } catch { /* Invalid signatures fail closed. */ }
  }
  check('trusted_collector_signature', trusted);
  check('live_evidence_required', envelope.dryRun === false && envelope.mode !== 'dry-run');
  return {
    status: !contractPassed ? 'failed' : trusted && envelope.dryRun === false && envelope.mode !== 'dry-run' ? 'verified' : 'missing',
    checks,
    summary: { channel, contractPassed, dryRun: envelope.dryRun !== false || envelope.mode === 'dry-run', runtimeAvailabilityVerified: contractPassed && trusted && envelope.dryRun === false && envelope.mode !== 'dry-run',
      // Do not echo arbitrary values, tokens, phone numbers, customer IDs, MIDs, or provider bodies.
      scope: 'redacted', limitation: 'Historical accepted and delivered/read receipt only; future send permission is not guaranteed.' },
  };
}
export const validateWhatsAppEvidence = input => validate(input, 'whatsapp');
export const validateMessengerEvidence = input => validate(input, 'messenger');
