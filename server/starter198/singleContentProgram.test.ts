import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LangGraphTestStore } from '../../scripts/langgraphTestStore.js';
import { createStarter198Repository } from './repository.js';
import { ensureSingleContentProgram } from './singleContentProgram.js';

test('single-content start reuses one enterprise program and never copies another tenant program', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'single-content-program-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new LangGraphTestStore(path.join(root, 'store.json'));
  await store.create('social_programs', { tenant_id: 'foreign', program_id: 'foreign-program' });
  const input = { repository: createStarter198Repository(store), tenantId: 'tenant', userId: 'owner',
    brief: { singleCreationRequestHash: 'a'.repeat(64), markets: ['US'], audience: 'Buyers', platforms: ['tiktok'] } as never,
    readProfile: (async () => ({ brand: { name: 'Confirmed brand' } })) as never };
  const first = await ensureSingleContentProgram(input), second = await ensureSingleContentProgram(input);
  assert.equal(first, second); assert.notEqual(first, 'foreign-program');
  const rows = await store.list<{ program_id: string; payload: { route: unknown } }>('social_programs', { where: { tenant_id: 'tenant' } });
  assert.equal(rows.totalItems, 1); assert.equal(rows.items[0]!.program_id, first);
  assert.equal(rows.items[0]!.payload.route, null, 'starting a film does not decide the enterprise operating route');
  await store.create('social_programs', { tenant_id: 'tenant', program_id: 'ambiguous' });
  await assert.rejects(ensureSingleContentProgram(input), /social_content_order_program_selection_required/);
});
