import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { LinkedInCompanyCollectionScope, LinkedInCompanyPaidPermit } from '../routes/linkedinCompanyPostPaidCollection.js';
import { APIFY_PAID_RAW_RECEIPT_MAX_BYTES } from '../routes/apifyPaidTikTokTransport.js';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const hex = (value: string) => /^[a-f0-9]{64}$/.test(value);
type RawReceipt = Parameters<LinkedInCompanyPaidPermit['persistRawReceipt']>[0];

/** A write-once receipt store, not a budget authority or a paid permit. */
export function createLinkedInCompanyReceiptStore(input: {
  root: string;
  scope: LinkedInCompanyCollectionScope;
  approvalRecordHash: string;
  actorId: string;
  actorInputSha256: string;
  operationId: string;
  tokenFingerprint: string;
}) {
  if (!path.isAbsolute(input.root) || path.normalize(input.root) !== input.root
    || !hex(input.approvalRecordHash) || !hex(input.actorInputSha256)
    || !hex(input.tokenFingerprint) || !input.actorId || !input.operationId
    || !input.scope.tenantId || !input.scope.runId) throw Error('linkedin_company_receipt_binding_invalid');
  let root: string;
  try { root = fs.realpathSync(input.root); }
  catch { throw Error('linkedin_company_receipt_shared_root_unavailable'); }
  if (root !== input.root || !fs.statSync(root).isDirectory()) throw Error('linkedin_company_receipt_shared_root_unavailable');
  const directory = path.join(root, '.linkedin-company-receipts');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.realpathSync(directory) !== directory || !fs.statSync(directory).isDirectory()) {
    throw Error('linkedin_company_receipt_shared_root_unavailable');
  }
  const identity = {
    scope: structuredClone(input.scope), approvalRecordHash: input.approvalRecordHash,
    actorId: input.actorId, actorInputSha256: input.actorInputSha256,
    operationId: input.operationId, tokenFingerprint: input.tokenFingerprint,
  };
  const prefix = `linkedin-company-receipt:${sha(JSON.stringify(identity))}:`;
  const receiptKey = (receipt: RawReceipt) => sha(JSON.stringify({
    identity, phase: receipt.phase, requestHash: receipt.requestHash,
    runId: receipt.runId ?? '', datasetId: receipt.datasetId ?? '',
    ...(receipt.phase === 'actor_poll' ? { responseSha256: sha(receipt.responseBody) } : {}),
  }));
  const validate = (receipt: RawReceipt) => {
    if (!['actor_submit', 'actor_poll', 'dataset_read'].includes(receipt.phase)
      || receipt.operationId !== identity.operationId || receipt.actorId !== identity.actorId
      || !hex(receipt.requestHash) || !Number.isInteger(receipt.httpStatus)
      || receipt.httpStatus < 100 || receipt.httpStatus > 599
      || typeof receipt.responseBody !== 'string'
      || (receipt.phase !== 'actor_submit' && (!receipt.runId || !receipt.datasetId))
      || Buffer.byteLength(receipt.responseBody, 'utf8') > APIFY_PAID_RAW_RECEIPT_MAX_BYTES) {
      throw Error('linkedin_company_receipt_invalid');
    }
  };
  return {
    async persistRawReceipt(receipt: RawReceipt): Promise<string> {
      validate(receipt);
      const key = receiptKey(receipt);
      const file = path.join(directory, `${key}.json`);
      const body = JSON.stringify({ schema: 'linkedin-company-raw-receipt.v1', identity, receipt });
      const contentHash = sha(body);
      const temp = path.join(directory, `${key}.${randomUUID()}.tmp`);
      const fd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, body); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      try {
        try { fs.linkSync(temp, file); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        if (fs.readFileSync(file, 'utf8') !== body) throw Error('linkedin_company_receipt_conflict');
        const dir = fs.openSync(directory, 'r');
        try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
      } finally { fs.unlinkSync(temp); }
      return `${prefix}${key}:${contentHash}`;
    },
    read(ref: string): RawReceipt {
      const match = /^linkedin-company-receipt:([a-f0-9]{64}):([a-f0-9]{64}):([a-f0-9]{64})$/.exec(ref);
      if (!match || `${prefix}${match[2]}:${match[3]}` !== ref) throw Error('linkedin_company_receipt_ref_invalid');
      const file = path.join(directory, `${match[2]}.json`);
      let body: string;
      try { body = fs.readFileSync(file, 'utf8'); }
      catch { throw Error('linkedin_company_receipt_missing'); }
      if (sha(body) !== match[3]) throw Error('linkedin_company_receipt_corrupt');
      let document: { schema?: unknown; identity?: unknown; receipt?: RawReceipt };
      try { document = JSON.parse(body); }
      catch { throw Error('linkedin_company_receipt_corrupt'); }
      if (document.schema !== 'linkedin-company-raw-receipt.v1'
        || JSON.stringify(document.identity) !== JSON.stringify(identity) || !document.receipt) {
        throw Error('linkedin_company_receipt_corrupt');
      }
      validate(document.receipt);
      if (receiptKey(document.receipt) !== match[2]) throw Error('linkedin_company_receipt_corrupt');
      return document.receipt;
    },
  };
}
