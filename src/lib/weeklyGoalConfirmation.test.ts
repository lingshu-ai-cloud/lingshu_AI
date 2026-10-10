import assert from 'node:assert/strict';
import { digitalEmployeeApi } from './digitalEmployeeApi';
const original = globalThis.fetch;
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
const requests: Array<{url: string; body: Record<string, unknown>}> = [];
globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
  return Response.json({ preparation: { goalId: 'goal-1', revision: 7, status: 'collecting' } });
};
try {
  const result = await digitalEmployeeApi.confirmWeeklyPreparation('goal-1', 7);
  assert.equal(result.preparation.status, 'collecting');
  await digitalEmployeeApi.confirmWeeklyPreparation('goal-1', 7);
  assert.deepEqual(requests[0], requests[1], 'retry must use the same persisted goal/revision and idempotency identity');
  assert.equal(requests[0].url, '/api/overseas/digital-employees/goals/goal-1/initial-preparation');
  assert.deepEqual(requests[0].body, { revision: 7, requestId: 'weekly-goal-1' });
  assert.equal(requests.some(request => request.url.endsWith('/approve')), false, 'collection must precede production approval');
  console.log('Weekly confirmation starts persisted collection before production approval');
} finally { globalThis.fetch = original; if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor); else Reflect.deleteProperty(globalThis, 'localStorage'); }
