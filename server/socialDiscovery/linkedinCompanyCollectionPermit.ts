import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { withPaidOperationLock } from '../lib/paidOperationLock.js';
import type { LinkedInCompanyPaidPermit } from '../routes/linkedinCompanyPostPaidCollection.js';
import { createLinkedInCompanyApprovalAssertion, type LinkedInCompanyCollectionApproval } from './linkedinCompanyCollectionApproval.js';
import { createLinkedInCompanyReceiptStore } from './linkedinCompanyReceiptStore.js';
import { quoteLinkedInCompanyCollection, type LinkedInCompanyQuotePorts } from './linkedinCompanyCollectionQuote.js';

type Quote = Awaited<ReturnType<typeof quoteLinkedInCompanyCollection>>;
type Status = 'reserved' | 'submitted_unknown' | 'submitted_known' | 'completed';
type Ledger = {
  schema: 'linkedin-company-paid-ledger.v1'; bindingHash: string; operationId: string;
  reservedCnyMicros: number; status: Status; requestHash: string | null;
  runId: string | null; datasetId: string | null; usageTotalUsd: number | null;
  submitReceiptRef: string | null; terminalReceiptRef: string | null;
  datasetRead: 'not_started' | 'submitted_unknown' | 'completed';
  datasetReceiptRef: string | null;
};
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code: string): never => { throw Error(`linkedin_company_paid_ledger_${code}`); };
const hex = (value: string) => /^[a-f0-9]{64}$/.test(value);
const providerData = (body: string): Record<string, unknown> => {
  let value: unknown;
  try { value = JSON.parse(body); } catch { return fail('receipt_invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('receipt_invalid');
  const outer = value as Record<string, unknown>;
  const data = outer.data ?? outer;
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('receipt_invalid');
  return data as Record<string, unknown>;
};

/** A shared-volume operation claim. It is inert until a trusted quote and exact approval are supplied. */
export async function reserveLinkedInCompanyCollection(input: {
  root: string; store: DataStore; approval: LinkedInCompanyCollectionApproval;
  ports: LinkedInCompanyQuotePorts; now?: () => number;
}): Promise<LinkedInCompanyPaidPermit> {
  const { approval } = input;
  const scope = { tenantId: approval.tenantId, runId: approval.discoveryRunId,
    companyUrl: approval.companyUrl, limit: approval.limit,
    dateFrom: approval.dateFrom, dateTo: approval.dateTo };
  const quote: Quote = await quoteLinkedInCompanyCollection({ store: input.store, scope,
    approval, ports: input.ports, now: input.now });
  if (!path.isAbsolute(input.root) || path.normalize(input.root) !== input.root
    || !fs.existsSync(input.root) || fs.realpathSync(input.root) !== input.root
    || !fs.statSync(input.root).isDirectory()) fail('shared_root_unavailable');
  if (quote.approvalRecordHash !== approval.recordHash || quote.actorId !== approval.actorId
    || quote.actorInputSha256 !== approval.actorInputSha256
    || quote.scope.tenantId !== approval.tenantId || quote.scope.runId !== approval.discoveryRunId
    || quote.scope.companyUrl !== approval.companyUrl || quote.scope.limit !== approval.limit
    || quote.scope.dateFrom !== approval.dateFrom || quote.scope.dateTo !== approval.dateTo
    || !hex(quote.tokenFingerprint) || !hex(quote.evidenceSha256)
    || !quote.accountRef?.trim() || !quote.operationId?.trim()
    || !Number.isSafeInteger(quote.reservedCnyMicros) || quote.reservedCnyMicros <= 0
    || quote.actorCnyMicros + quote.nonActorCnyMicros !== quote.reservedCnyMicros
    || quote.reservedCnyMicros > Math.round(approval.maximumCny * 1_000_000)
    || !Number.isFinite(quote.maxTotalChargeUsd) || quote.maxTotalChargeUsd <= 0
    || !Number.isFinite(Date.parse(quote.validUntil))) fail('quote_invalid');
  const assertApproved = createLinkedInCompanyApprovalAssertion({ store: input.store, approval, now: input.now });
  const assertCurrent = async () => {
    await assertApproved(quote.scope, quote.actorInputSha256);
    if (Date.parse(quote.validUntil) <= (input.now?.() ?? Date.now())) fail('quote_expired');
    const current = await quoteLinkedInCompanyCollection({ store: input.store, scope,
      approval, ports: input.ports, now: input.now });
    if (sha(current) !== sha(quote)) fail('quote_changed');
  };
  await assertCurrent();
  const identity = { operationId: quote.operationId, scope: quote.scope, approvalRecordHash: approval.recordHash,
    actorId: quote.actorId, actorInputSha256: quote.actorInputSha256, accountRef: quote.accountRef,
    tokenFingerprint: quote.tokenFingerprint, evidenceSha256: quote.evidenceSha256,
    maxTotalChargeUsd: quote.maxTotalChargeUsd, reservedCnyMicros: quote.reservedCnyMicros };
  const bindingHash = sha(identity);
  const directory = path.join(input.root, '.linkedin-company-paid-ledger');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.realpathSync(directory) !== directory) fail('shared_root_unavailable');
  const file = path.join(directory, `${sha([approval.recordHash, quote.operationId])}.json`);
  const lockRoot = path.join(directory, '.locks');
  const receiptStore = createLinkedInCompanyReceiptStore({ root: input.root, scope: quote.scope,
    approvalRecordHash: approval.recordHash, actorId: quote.actorId,
    actorInputSha256: quote.actorInputSha256, operationId: quote.operationId,
    tokenFingerprint: quote.tokenFingerprint });
  const read = (): Ledger | null => {
    if (!fs.existsSync(file)) return null;
    let row: Ledger;
    try { row = JSON.parse(fs.readFileSync(file, 'utf8')) as Ledger; }
    catch { return fail('corrupt'); }
    if (row.schema !== 'linkedin-company-paid-ledger.v1' || row.bindingHash !== bindingHash
      || row.operationId !== quote.operationId || row.reservedCnyMicros !== quote.reservedCnyMicros
      || !['reserved', 'submitted_unknown', 'submitted_known', 'completed'].includes(row.status)
      || !['not_started', 'submitted_unknown', 'completed'].includes(row.datasetRead)
      || (row.status === 'reserved' && row.requestHash !== null)
      || (row.status !== 'reserved' && (!row.requestHash || !hex(row.requestHash)))
      || (['submitted_known', 'completed'].includes(row.status) && (!row.runId || !row.datasetId || !row.submitReceiptRef))
      || (row.status === 'completed' && (!row.terminalReceiptRef || row.usageTotalUsd === null))
      || (row.datasetRead === 'completed' && !row.datasetReceiptRef)) fail('corrupt');
    return row;
  };
  const write = (row: Ledger) => {
    const temp = `${file}.${randomUUID()}.tmp`;
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(row)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    try { fs.renameSync(temp, file); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    const dir = fs.openSync(directory, 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  };
  const mutate = <T>(fn: (row: Ledger) => Promise<T> | T) => withPaidOperationLock(lockRoot, file, async () => {
    const row = read(); if (!row) fail('reservation_missing');
    const result = await fn(row!); write(row!); return result;
  });
  await withPaidOperationLock(lockRoot, file, async () => {
    await assertCurrent();
    const existing = read();
    if (existing) return;
    write({ schema: 'linkedin-company-paid-ledger.v1', bindingHash, operationId: quote.operationId,
      reservedCnyMicros: quote.reservedCnyMicros, status: 'reserved', requestHash: null,
      runId: null, datasetId: null, usageTotalUsd: null,
      submitReceiptRef: null, terminalReceiptRef: null,
      datasetRead: 'not_started', datasetReceiptRef: null });
  });
  const verifyRequest = (request: { actorId: string; requestHash: string; maxTotalChargeUsd: number }, row: Ledger) => {
    if (request.actorId !== quote.actorId || !hex(request.requestHash)
      || request.maxTotalChargeUsd !== quote.maxTotalChargeUsd
      || (row.requestHash && row.requestHash !== request.requestHash)) fail('request_changed');
  };
  return {
    operationId: quote.operationId, actorId: quote.actorId, maxTotalChargeUsd: quote.maxTotalChargeUsd,
    scope: structuredClone(quote.scope), actorInputSha256: quote.actorInputSha256,
    tokenFingerprint: quote.tokenFingerprint, assertApproved,
    async persistRawReceipt(receipt) {
      const ref = await receiptStore.persistRawReceipt(receipt);
      if (receipt.phase !== 'dataset_read') return ref;
      await mutate(row => {
        if (row.datasetRead !== 'submitted_unknown' || row.requestHash !== receipt.requestHash
          || row.runId !== receipt.runId || row.datasetId !== receipt.datasetId
          || receipt.httpStatus !== 200) fail('dataset_receipt_invalid');
        let body: unknown;
        try { body = JSON.parse(receipt.responseBody); } catch { return fail('dataset_receipt_invalid'); }
        if (!Array.isArray(body) || body.length > quote.scope.limit
          || body.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
          fail('dataset_receipt_invalid');
        }
        row.datasetRead = 'completed'; row.datasetReceiptRef = ref;
      });
      return ref;
    },
    async inspect(request) {
      const row = read(); if (!row) fail('reservation_missing');
      verifyRequest(request, row!);
      if (row!.status === 'reserved') await assertCurrent();
      if (row!.status === 'submitted_known' || row!.status === 'completed') {
        return row!.status === 'completed'
          ? { status: 'completed', runId: row!.runId!, datasetId: row!.datasetId!, usageTotalUsd: row!.usageTotalUsd! }
          : { status: 'submitted_known', runId: row!.runId!, datasetId: row!.datasetId! };
      }
      return { status: row!.status };
    },
    async beforeSubmit(request) {
      await mutate(async row => {
        await assertCurrent(); verifyRequest(request, row);
        if (row.status !== 'reserved') fail('submission_unknown_no_replay');
        row.requestHash = request.requestHash; row.status = 'submitted_unknown';
      });
    },
    async recordRun(receipt) {
      await mutate(row => {
        if (row.status !== 'submitted_unknown' || !row.requestHash || !receipt.runId || !receipt.datasetId
          || receipt.maxTotalChargeUsd !== quote.maxTotalChargeUsd || !receipt.rawReceiptRef) fail('run_receipt_invalid');
        const raw = receiptStore.read(receipt.rawReceiptRef!);
        if (raw.phase !== 'actor_submit' || raw.requestHash !== row.requestHash || raw.httpStatus < 200
          || raw.httpStatus >= 300) fail('run_receipt_invalid');
        const provider = providerData(raw.responseBody);
        if (provider.id !== receipt.runId || provider.defaultDatasetId !== receipt.datasetId) fail('run_receipt_invalid');
        row.runId = receipt.runId; row.datasetId = receipt.datasetId;
        row.submitReceiptRef = receipt.rawReceiptRef!; row.status = 'submitted_known';
      });
    },
    async recordTerminal(receipt) {
      await mutate(row => {
        if (row.status === 'completed' && row.runId === receipt.runId
          && row.usageTotalUsd === receipt.usageTotalUsd
          && row.terminalReceiptRef === receipt.rawReceiptRef) return;
        if (row.status !== 'submitted_known' || row.runId !== receipt.runId || !receipt.rawReceiptRef
          || !['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(receipt.status)
          || !Number.isFinite(receipt.usageTotalUsd) || receipt.usageTotalUsd < 0
          || receipt.usageTotalUsd > quote.maxTotalChargeUsd) fail('terminal_receipt_invalid');
        const raw = receiptStore.read(receipt.rawReceiptRef!);
        if (raw.phase !== 'actor_poll' || raw.requestHash !== row.requestHash
          || raw.runId !== row.runId || raw.datasetId !== row.datasetId || raw.httpStatus !== 200) fail('terminal_receipt_invalid');
        const provider = providerData(raw.responseBody);
        if (provider.id !== receipt.runId || provider.status !== receipt.status
          || provider.usageTotalUsd !== receipt.usageTotalUsd) fail('terminal_receipt_invalid');
        row.status = 'completed'; row.usageTotalUsd = receipt.usageTotalUsd;
        row.terminalReceiptRef = receipt.rawReceiptRef!;
      });
    },
    async beforeDatasetRead(request) {
      await mutate(async row => {
        await assertCurrent();
        if (row.status !== 'completed' || row.runId !== request.runId
          || row.datasetId !== request.datasetId || request.maxItems !== quote.scope.limit
          || row.datasetRead !== 'not_started' || !row.terminalReceiptRef) fail('dataset_read_not_authorized');
        const raw = receiptStore.read(row.terminalReceiptRef!);
        if (providerData(raw.responseBody).status !== 'SUCCEEDED') fail('dataset_read_not_authorized');
        row.datasetRead = 'submitted_unknown';
      });
    },
  };
}
