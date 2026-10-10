import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { createMobileWorkbenchQueueRouter } from './mobileWorkbenchQueue.js';

test('release contract: queue exhausts pages, filters foreign records, and fails closed', async () => {
  let unavailable = false;
  const pageReads: number[] = [];
  const store = {
    list: async (collection: string, query: { page?: number }) => {
      if (unavailable) throw Error('storage unavailable');
      const page = query.page || 1;
      if (collection === 'workflow_tasks') {
        pageReads.push(page);
        return { items: page === 1
          ? [{ id: 'first', tenant_id: 'A', status: 'failed' }, { id: 'foreign', tenant_id: 'B', status: 'failed' }]
          : [{ id: 'second', tenant_id: 'A', status: 'running' }, { id: 'finished', tenant_id: 'A', status: 'succeeded' }], totalPages: 2 };
      }
      if (collection === 'approval_requests') return { items: [
        { id: 'valid', tenant_id: 'A', status: 'pending', task_id: 'second' },
        { id: 'orphan', tenant_id: 'A', status: 'pending', task_id: 'foreign' },
        { id: 'decided', tenant_id: 'A', status: 'approved', task_id: 'second' },
      ], totalPages: 1 };
      if (collection === 'mobile_workbench_snoozes') return { items: [
        { id: 'future', tenant_id: 'A', user_id: 'u', matter_id: 'task:first', until: Date.now() + 3600000 },
        { id: 'expired', tenant_id: 'A', user_id: 'u', matter_id: 'task:second', until: Date.now() - 1 },
        { id: 'other-user', tenant_id: 'A', user_id: 'other', matter_id: 'task:other', until: Date.now() + 3600000 },
      ], totalPages: 1 };
      return { items: [], totalPages: 1 };
    },
  } as unknown as DataStore;
  const app = express();
  app.use((_req, res, next) => { res.locals.tenantId = 'A'; res.locals.userId = 'u'; next(); });
  app.use(createMobileWorkbenchQueueRouter(store));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/queue`;
  try {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const body = await response.json();
    assert.deepEqual(pageReads, [1, 2]);
    assert.deepEqual(body.tasks.map((item: Record_) => item.id), ['first', 'second']);
    assert.deepEqual(body.approvals.map((item: Record_) => item.id), ['valid']);
    assert.deepEqual(Object.keys(body.snoozes), ['task:first']);
    unavailable = true;
    const failed = await fetch(url);
    assert.equal(failed.status, 503);
    const error = await failed.json();
    assert.equal(error.tasks, undefined);
    assert.equal(error.error.includes('storage unavailable'), false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
