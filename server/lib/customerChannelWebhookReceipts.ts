import { createHash } from 'node:crypto';

export interface SignedCustomerChannelReceipt {
  tenantId: string; channel: 'messenger' | 'instagram'; nativeAccountId: string;
  recipientId: string; providerMessageId: string; status: 'sent' | 'delivered' | 'read';
  occurredAt: string; eventKind: 'echo' | 'delivery' | 'read'; eventHash: string;
  signedBodyHash: string; verifiedSignature: true; body?: string;
}
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');

/** Entries must already be filtered to tenant-owned accounts after raw-body HMAC verification. */
export function extractSignedCustomerChannelReceipts(input: {
  tenantId: string; channel: 'messenger' | 'instagram'; entries: unknown[];
  rawBody: Buffer; verifiedSignature: true;
}): SignedCustomerChannelReceipt[] {
  if (input.verifiedSignature !== true || !input.tenantId || !Buffer.isBuffer(input.rawBody)) throw new Error('channel_receipt_signature_required');
  const result: SignedCustomerChannelReceipt[] = [], signedBodyHash = hash(input.rawBody);
  for (const rawEntry of input.entries) {
    const entry = object(rawEntry), nativeAccountId = text(entry.id);
    if (!nativeAccountId || !Array.isArray(entry.messaging)) continue;
    const ownIds = new Set([nativeAccountId, text(entry.messagingAccountId)].filter(Boolean));
    for (const rawEvent of entry.messaging) {
      const event = object(rawEvent), sender = text(object(event.sender).id), recipient = text(object(event.recipient).id);
      const message = object(event.message), delivery = object(event.delivery), read = object(event.read);
      const kind = message.is_echo === true ? 'echo' : event.read ? 'read' : event.delivery ? 'delivery' : null;
      if (!kind) continue;
      const observation = kind === 'read' ? read : delivery;
      const timestamp = Number(event.timestamp ?? observation.watermark ?? entry.time);
      if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(new Date(timestamp).getTime())) continue;
      const target = kind === 'echo' ? recipient : sender;
      if (!target || ownIds.has(target) || (kind === 'echo' ? !ownIds.has(sender) : !ownIds.has(recipient))) continue;
      // A watermark without individual MIDs cannot resolve a particular send request.
      const mids = kind === 'echo' ? [text(message.mid)] : Array.isArray(observation.mids) ? observation.mids.map(text) : [];
      for (const providerMessageId of new Set(mids.filter(Boolean))) {
        result.push({ tenantId: input.tenantId, channel: input.channel, nativeAccountId, recipientId: target,
          providerMessageId, status: kind === 'echo' ? 'sent' : kind === 'read' ? 'read' : 'delivered',
          occurredAt: new Date(timestamp).toISOString(), eventKind: kind,
          eventHash: hash(JSON.stringify({ nativeAccountId, rawEvent })), signedBodyHash, verifiedSignature: true,
          ...(kind === 'echo' && typeof message.text === 'string' ? { body: message.text } : {}),
        });
      }
    }
  }
  return result;
}
