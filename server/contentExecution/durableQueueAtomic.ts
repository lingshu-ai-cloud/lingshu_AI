import type { DataStore } from '../storage/datastore.js';
import { CONTENT_EXECUTION_JOB_COLLECTION } from './context.js';

/**
 * Publish one content-execution job transition only when the caller's durable
 * snapshot is still current. A method-shaped fallback is insufficient: the
 * selected backend must explicitly attest collection or global CAS support.
 */
export async function atomicContentExecutionJobUpdate(
  dataStore: DataStore,
  id: string,
  expected: Record<string, unknown>,
  patch: Record<string, unknown>,
  unsupportedCode: string,
): Promise<boolean> {
  const supported = dataStore.compareAndSwap && (
    dataStore.supportsAtomicCompareAndSwapFor
      ? await dataStore.supportsAtomicCompareAndSwapFor(CONTENT_EXECUTION_JOB_COLLECTION)
      : await dataStore.supportsAtomicCompareAndSwap?.()
  ) === true;
  if (!supported) throw new Error(unsupportedCode);
  return dataStore.compareAndSwap!(CONTENT_EXECUTION_JOB_COLLECTION, id, expected, patch);
}
