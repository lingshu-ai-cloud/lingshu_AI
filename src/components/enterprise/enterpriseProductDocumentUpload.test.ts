import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeConfirmedProductDocuments, uploadEnterpriseProductDocuments } from './enterpriseProductDocumentUpload';

const file = (name: string) => new File(['evidence'], name, { type: 'application/pdf' });
const asset = (name: string, url?: string) => ({ name, type: 'application/pdf', size: 8, updatedAt: '2026-10-22', url });

test('only confirmed upload receipts become product documents', async () => {
  const calls: string[] = [];
  const result = await uploadEnterpriseProductDocuments([file('ok.pdf'), file('failed.pdf'), file('no-url.pdf')], 0, 3, async input => {
    calls.push(input.name);
    if (input.name === 'failed.pdf') throw new Error('network result unknown');
    return asset(input.name, input.name === 'ok.pdf' ? '/api/overseas/enterprise/assets/ok.pdf' : undefined);
  });
  assert.deepEqual(calls, ['ok.pdf', 'failed.pdf', 'no-url.pdf']);
  assert.deepEqual(result.confirmed.map(item => item.name), ['ok.pdf']);
  assert.deepEqual(result.unresolvedNames, ['failed.pdf', 'no-url.pdf']);
  assert.equal(result.skippedCount, 0);
});

test('document cap prevents writes for files beyond available slots', async () => {
  const calls: string[] = [];
  const upload = async (input: File) => { calls.push(input.name); return asset(input.name, `/assets/${input.name}`); };
  const result = await uploadEnterpriseProductDocuments([file('first.pdf'), file('second.pdf')], 2, 3, upload);
  assert.deepEqual(calls, ['first.pdf']);
  assert.equal(result.confirmed.length, 1);
  assert.equal(result.skippedCount, 1);
  const full = await uploadEnterpriseProductDocuments([file('third.pdf')], 3, 3, upload);
  assert.deepEqual(calls, ['first.pdf']);
  assert.equal(full.skippedCount, 1);
});

test('confirmed receipts merge without duplicate URLs or exceeding the cap', () => {
  const current = [asset('existing.pdf', '/assets/existing.pdf')];
  const merged = mergeConfirmedProductDocuments(current, [
    asset('duplicate.pdf', '/assets/existing.pdf'),
    asset('new.pdf', '/assets/new.pdf'),
    asset('extra.pdf', '/assets/extra.pdf'),
  ], 2);
  assert.deepEqual(merged.map(item => item.name), ['existing.pdf', 'new.pdf']);
  assert.deepEqual(current.map(item => item.name), ['existing.pdf']);
});
