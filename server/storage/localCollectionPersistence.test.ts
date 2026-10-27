import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  atomicWriteLocalCollection,
  compactLocalCollectionRecords,
  sweepStaleLocalCollectionTemporaryFiles,
} from './localCollectionPersistence.js';

test('local heartbeat records discard stale history and keep a bounded newest set', () => {
  const now = Date.parse('2026-10-27T08:00:00.000Z');
  const records = [
    { id: 'stale', last_seen_at: '2026-10-25T08:00:00.000Z' },
    { id: 'newest', last_seen_at: '2026-10-27T07:59:00.000Z' },
    { id: 'older', last_seen_at: '2026-10-27T07:58:00.000Z' },
    { id: 'oldest-retained', last_seen_at: '2026-10-27T07:57:00.000Z' },
  ];
  const compacted = compactLocalCollectionRecords('social_operating_worker_heartbeats', records, {
    now,
    env: { WORKER_HEARTBEAT_RETENTION_HOURS: '24', WORKER_HEARTBEAT_LOCAL_MAX_RECORDS: '2' },
  }) as Array<{ id: string }>;
  assert.deepEqual(compacted.map(record => record.id), ['newest', 'older']);
  assert.equal(compactLocalCollectionRecords('unrelated', records), records);
});

test('failed local atomic write removes its temporary full-size copy', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-collection-write-'));
  const target = path.join(root, 'collection.json');
  try {
    await fs.mkdir(target);
    assert.throws(() => atomicWriteLocalCollection(target, [{ id: 'record' }]));
    const entries = await fs.readdir(root);
    assert.deepEqual(entries, ['collection.json']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('successful local atomic write leaves only the committed collection', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-collection-write-'));
  const target = path.join(root, 'collection.json');
  try {
    atomicWriteLocalCollection(target, [{ id: 'record' }]);
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), [{ id: 'record' }]);
    assert.deepEqual(await fs.readdir(root), ['collection.json']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('local collection sweep removes only stale writer-shaped temporary files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-collection-sweep-'));
  const target = path.join(root, 'collection.json');
  const stale = `${target}.123.123e4567-e89b-42d3-a456-426614174000.tmp`;
  const recent = `${target}.456.123e4567-e89b-42d3-a456-426614174001.tmp`;
  const unrelated = `${target}.customer-backup.tmp`;
  const now = Date.parse('2026-10-27T08:00:00.000Z');
  try {
    await Promise.all([fs.writeFile(stale, 'stale'), fs.writeFile(recent, 'recent'), fs.writeFile(unrelated, 'keep')]);
    await fs.utimes(stale, new Date(now - 7 * 60 * 60_000), new Date(now - 7 * 60 * 60_000));
    assert.equal(sweepStaleLocalCollectionTemporaryFiles(target, { now, force: true }), 1);
    assert.deepEqual((await fs.readdir(root)).sort(), [path.basename(recent), path.basename(unrelated)].sort());
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
