import { createHash, timingSafeEqual } from 'node:crypto';

export const DOUYIN_WEBHOOK_ACK_DEADLINE_MS = 5_000;

export class DouyinWebhookError extends Error {
  constructor(readonly code: string, readonly status = 400, message = code) {
    super(message);
    this.name = 'DouyinWebhookError';
  }
}
/** X-Douyin-Signature = SHA1(client_secret + raw request body). */
export function verifyDouyinWebhookSignature(
  clientSecret: string,
  rawBody: Buffer,
  signatureHeader: unknown,
): boolean {
  const signature = String(signatureHeader ?? '').trim().toLowerCase();
  if (!clientSecret || !Buffer.isBuffer(rawBody) || !/^[a-f0-9]{40}$/.test(signature)) return false;
  const expected = createHash('sha1').update(clientSecret).update(rawBody).digest();
  const received = Buffer.from(signature, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export interface DouyinWebhookClaimStore {
  claim(messageId: string, receivedAt: string): Promise<boolean>;
}

export interface DouyinWebhookEnvelope {
  messageId: string;
  receivedAt: string;
  rawBody: Buffer;
}

/**
 * Performs only bounded validation and durable de-duplication on the ACK path.
 * Business processing must be queued by `enqueue` and never delay the response.
 */
export async function acceptDouyinWebhook(input: {
  clientSecret: string;
  signatureHeader: unknown;
  messageIdHeader: unknown;
  rawBody: Buffer;
  claimStore: DouyinWebhookClaimStore;
  enqueue: (envelope: DouyinWebhookEnvelope) => void;
  now?: Date;
}): Promise<{ accepted: boolean; duplicate: boolean; ackDeadlineMs: 5000 }> {
  if (!verifyDouyinWebhookSignature(input.clientSecret, input.rawBody, input.signatureHeader)) {
    throw new DouyinWebhookError('douyin_webhook_signature_invalid', 403);
  }
  const messageId = String(input.messageIdHeader ?? '').trim();
  if (!/^[a-z0-9:_-]{1,240}$/i.test(messageId)) {
    throw new DouyinWebhookError('douyin_webhook_message_id_invalid');
  }
  const receivedAt = (input.now ?? new Date()).toISOString();
  const claimed = await input.claimStore.claim(messageId, receivedAt);
  if (claimed) input.enqueue({ messageId, receivedAt, rawBody: Buffer.from(input.rawBody) });
  return { accepted: true, duplicate: !claimed, ackDeadlineMs: DOUYIN_WEBHOOK_ACK_DEADLINE_MS };
}
