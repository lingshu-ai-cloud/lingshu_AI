import { AsyncLocalStorage } from 'node:async_hooks';
import type { DataStore } from '../storage/datastore.js';

export const CONTENT_EXECUTION_JOB_COLLECTION = 'content_execution_jobs';

export type ContentProviderReceiptState =
  | 'submitting'
  | 'accepted'
  | 'completed'
  | 'failed'
  | 'unknown';

export interface ContentProviderReceipt {
  provider: string;
  requestId: string;
  state: ContentProviderReceiptState;
  providerTaskId: string | null;
  metadata: Record<string, unknown>;
  firstRecordedAt: string;
  updatedAt: string;
}

interface ContentExecutionContextValue {
  dataStore: DataStore;
  jobId: string;
  receipts: ContentProviderReceipt[];
  writeChain: Promise<void>;
}

const executionContext = new AsyncLocalStorage<ContentExecutionContextValue>();

function compact(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const serialized = JSON.stringify(value);
  if (serialized.length > 16_384) throw new Error('content_provider_receipt_metadata_too_large');
  return JSON.parse(serialized) as Record<string, unknown>;
}

export function parseContentProviderReceipts(value: unknown): ContentProviderReceipt[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const provider = compact(row.provider, 80);
    const requestId = compact(row.requestId, 240);
    const state = compact(row.state, 20) as ContentProviderReceiptState;
    if (!provider || !requestId || !['submitting', 'accepted', 'completed', 'failed', 'unknown'].includes(state)) return [];
    return [{
      provider,
      requestId,
      state,
      providerTaskId: compact(row.providerTaskId, 240) || null,
      metadata: safeMetadata(row.metadata),
      firstRecordedAt: compact(row.firstRecordedAt, 40) || new Date(0).toISOString(),
      updatedAt: compact(row.updatedAt, 40) || new Date(0).toISOString(),
    }];
  });
}

export async function runWithContentExecutionContext<T>(input: {
  dataStore: DataStore;
  jobId: string;
  providerReceipts?: unknown;
  action: () => Promise<T>;
}): Promise<T> {
  const value: ContentExecutionContextValue = {
    dataStore: input.dataStore,
    jobId: input.jobId,
    receipts: parseContentProviderReceipts(input.providerReceipts),
    writeChain: Promise.resolve(),
  };
  return executionContext.run(value, input.action);
}

export function currentContentProviderReceipt(input: {
  provider: string;
  requestId: string;
}): ContentProviderReceipt | null {
  const current = executionContext.getStore();
  if (!current) return null;
  return current.receipts.find(item => item.provider === input.provider && item.requestId === input.requestId) ?? null;
}

/**
 * Persist a paid-provider handoff before the caller continues. This is the
 * write-ahead receipt used after worker restarts: a submitted request is
 * reconciled from its provider id or saved result and is never blindly sent
 * again.
 */
export async function recordCurrentContentProviderReceipt(input: {
  provider: string;
  requestId: string;
  state: ContentProviderReceiptState;
  providerTaskId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const current = executionContext.getStore();
  if (!current) return;
  const provider = compact(input.provider, 80);
  const requestId = compact(input.requestId, 240);
  if (!provider || !requestId) throw new Error('content_provider_receipt_identity_invalid');
  const providerTaskId = compact(input.providerTaskId, 240) || null;
  const metadata = safeMetadata(input.metadata);
  const now = new Date().toISOString();
  const prior = current.receipts.find(item => item.provider === provider && item.requestId === requestId);
  const receipt: ContentProviderReceipt = {
    provider,
    requestId,
    state: input.state,
    providerTaskId: providerTaskId ?? prior?.providerTaskId ?? null,
    metadata: { ...(prior?.metadata ?? {}), ...metadata },
    firstRecordedAt: prior?.firstRecordedAt ?? now,
    updatedAt: now,
  };
  current.receipts = [
    ...current.receipts.filter(item => !(item.provider === provider && item.requestId === requestId)),
    receipt,
  ];
  const aggregateState = current.receipts.some(item => ['submitting', 'accepted', 'unknown'].includes(item.state))
    ? 'accepted'
    : current.receipts.some(item => item.state === 'completed') ? 'completed'
      : current.receipts.some(item => item.state === 'failed') ? 'failed' : 'none';
  current.writeChain = current.writeChain.then(async () => {
    const updated = await current.dataStore.update(CONTENT_EXECUTION_JOB_COLLECTION, current.jobId, {
      provider_state: aggregateState,
      provider_receipts: current.receipts,
      updated_at: now,
    });
    if (!updated) throw new Error('content_provider_receipt_persist_failed');
  });
  await current.writeChain;
}
