import { AsyncLocalStorage } from 'node:async_hooks';
import type { BusinessSnapshot } from './businessSnapshot.js';

/** Scoped backend adapters. No HTTP request or environment flag can install them.
 * The production default resolves original services. Isolated simulations may
 * replace external preparation and read models while retaining the real DAG,
 * proof validation, approvals and state transitions.
 */
export interface ExecutionAdapters {
  snapshot?: (tenantId: string, range?: { startsAt?: string; endsAt?: string }) => Promise<BusinessSnapshot>;
  customers?: (tenantId?: string) => Array<Record<string, any>>;
  prepare?: (input: { tenantId: string; run: { id: string }; task: { id: string; task_key: string } }) => Promise<boolean>;
}
const context = new AsyncLocalStorage<ExecutionAdapters>();
export const currentExecutionAdapters = () => context.getStore();
export function withExecutionAdapters<T>(adapters: ExecutionAdapters, action: () => Promise<T>): Promise<T> {
  return context.run(adapters, action);
}
