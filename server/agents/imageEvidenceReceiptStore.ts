import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { SocialTaskBudgetScope } from '../lib/socialContentTaskBudget.js';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

/** Content and identity-bound response receipt, written before budget settlement. */
export function createImageEvidenceReceiptStore(input: {
  root: string; scope: SocialTaskBudgetScope; operationId: string; requestSha256: string;
}) {
  if (!input.root || !input.operationId || !/^[a-f0-9]{64}$/.test(input.requestSha256)) {
    throw Error('image_evidence_receipt_binding_invalid');
  }
  const root = path.resolve(input.root);
  const identity = { scope: structuredClone(input.scope), operationId: input.operationId, requestSha256: input.requestSha256 };
  const key = sha(JSON.stringify(identity));
  const file = path.join(root, `${key}.json`);
  const prefix = `image-evidence-receipt:${key}:`;
  function decode(bytes: string) {
    let document: { schemaVersion?: unknown; identity?: unknown; response?: unknown; contentSha256?: unknown };
    try { document = JSON.parse(bytes); } catch { throw Error('image_evidence_receipt_corrupt'); }
    const response = document && typeof document === 'object' ? document.response as { status?: unknown; body?: unknown } | undefined : undefined;
    if (document?.schemaVersion !== 1 || JSON.stringify(document.identity) !== JSON.stringify(identity)
      || !response || typeof response.status !== 'number' || !Number.isInteger(response.status) || response.status < 100 || response.status > 599
      || typeof response.body !== 'string' || document.contentSha256 !== sha(JSON.stringify({ identity, response }))) {
      throw Error('image_evidence_receipt_corrupt');
    }
    return { status: Number(response.status), body: response.body };
  }
  return {
    async persist(receipt: { requestSha256: string; response: unknown }): Promise<string> {
      if (receipt.requestSha256 !== input.requestSha256 || !receipt.response || typeof receipt.response !== 'object') {
        throw Error('image_evidence_receipt_binding_invalid');
      }
      const response = receipt.response as { status?: unknown; body?: unknown };
      if (typeof response.status !== 'number' || !Number.isInteger(response.status) || response.status < 100 || response.status > 599
        || typeof response.body !== 'string') throw Error('image_evidence_receipt_response_invalid');
      const contentSha256 = sha(JSON.stringify({ identity, response }));
      const bytes = JSON.stringify({ schemaVersion: 1, identity, response, contentSha256 });
      if (Buffer.byteLength(bytes) > 8 * 1024 * 1024) throw Error('image_evidence_receipt_too_large');
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      const temp = path.join(root, `${key}.${randomUUID()}.tmp`);
      const fd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      try {
        try { fs.linkSync(temp, file); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        const existing = fs.readFileSync(file, 'utf8');
        if (existing !== bytes) throw Error('image_evidence_receipt_conflict');
        const dir = fs.openSync(root, 'r');
        try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
      } finally { fs.unlinkSync(temp); }
      return `${prefix}${contentSha256}`;
    },
    read(ref: string) {
      if (!ref.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(ref.slice(prefix.length))) throw Error('image_evidence_receipt_ref_invalid');
      const bytes = fs.readFileSync(file, 'utf8');
      const response = decode(bytes);
      if (sha(JSON.stringify({ identity, response })) !== ref.slice(prefix.length)) throw Error('image_evidence_receipt_ref_invalid');
      return response;
    },
  };
}
