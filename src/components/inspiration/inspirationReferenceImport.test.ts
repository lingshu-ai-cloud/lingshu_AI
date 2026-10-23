import assert from 'node:assert/strict';
import test from 'node:test';
import type { Dispatch, SetStateAction } from 'react';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { createInspirationReferenceImporter } from './inspirationReferenceImport';

function stateSetter<T>(initial: T) {
  let current = initial;
  const set: Dispatch<SetStateAction<T>> = value => {
    current = typeof value === 'function' ? (value as (previous: T) => T)(current) : value;
  };
  return { set, get: () => current };
}

test('invalid reference files are rejected before upload or analysis', async () => {
  const messages: string[] = [];
  let requests = 0;
  const videos = stateSetter<TrendVideo[]>([]);
  const selected = stateSetter<TrendVideo | null>(null);
  const importer = createInspirationReferenceImporter({
    setImportingReference: () => undefined,
    setMaterialMessage: value => messages.push(value),
    setCrawledVideos: videos.set,
    setSelectedVideo: selected.set,
    referenceUploadInputRef: { current: null },
    refreshInventory: async () => undefined,
    refreshVideos: async () => undefined,
    request: async () => { requests += 1; throw new Error('unexpected network request'); },
  });
  await importer(new File(['x'], 'reference.png', { type: 'image/png' }));
  const oversized = new File(['x'], 'large.mp4', { type: 'video/mp4' });
  Object.defineProperty(oversized, 'size', { value: 32 * 1024 * 1024 + 1 });
  await importer(oversized);
  assert.deepEqual(messages, ['对标视频请使用 MP4 文件', '对标视频不能超过 32 MB']);
  assert.equal(requests, 0);
});

test('import reads the persisted record and polls it without a second upload', async () => {
  const requests: Array<{ path: string; method: string }> = [];
  const messages: string[] = [];
  const busy: boolean[] = [];
  const videos = stateSetter<TrendVideo[]>([]);
  const selected = stateSetter<TrendVideo | null>(null);
  const input = { value: 'selected' } as HTMLInputElement;
  let inventoryRefreshes = 0;
  let listRefreshes = 0;
  const importer = createInspirationReferenceImporter({
    setImportingReference: value => busy.push(value),
    setMaterialMessage: value => messages.push(value),
    setCrawledVideos: videos.set,
    setSelectedVideo: selected.set,
    referenceUploadInputRef: { current: input },
    refreshInventory: async () => { inventoryRefreshes += 1; },
    refreshVideos: async () => { listRefreshes += 1; },
    authorization: () => ({ Authorization: 'Bearer test' }),
    delay: async () => undefined,
    request: async (input, init) => {
      const path = String(input);
      requests.push({ path, method: init?.method || 'GET' });
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test');
      if (path.includes('/import-reference-file?')) {
        assert.equal(init?.body instanceof File, true);
        return new Response(JSON.stringify({ id: 'record-1' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: 'record-1', platform: 'tiktok', title: '对标片',
        aiAnalysis: JSON.stringify({ geminiStatus: 'analyzed' }),
      }), { status: 200 });
    },
  });
  await importer(new File(['video'], 'reference.mp4', { type: 'video/mp4' }));
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  assert.deepEqual(requests.map(value => value.method), ['POST', 'GET', 'GET']);
  assert.equal(requests[0]?.path.includes('title=reference'), true);
  assert.equal(selected.get()?.recordId, 'record-1');
  assert.equal(videos.get().length, 1);
  assert.equal(inventoryRefreshes, 1);
  assert.equal(listRefreshes, 1);
  assert.deepEqual(busy, [true, false]);
  assert.equal(input.value, '');
  assert.match(messages.at(-1) || '', /逐镜分析完成/);
});

test('a switched authorization cannot read or display the previous tenant import', async () => {
  let authorization = 'Bearer tenant-a';
  const requests: string[] = [];
  const videos = stateSetter<TrendVideo[]>([]);
  const selected = stateSetter<TrendVideo | null>(null);
  const importer = createInspirationReferenceImporter({
    setImportingReference: () => undefined,
    setMaterialMessage: () => undefined,
    setCrawledVideos: videos.set,
    setSelectedVideo: selected.set,
    referenceUploadInputRef: { current: null },
    refreshInventory: async () => undefined,
    refreshVideos: async () => undefined,
    authorization: () => ({ Authorization: authorization }),
    request: async input => {
      requests.push(String(input));
      authorization = 'Bearer tenant-b';
      return new Response(JSON.stringify({ id: 'tenant-a-record' }), { status: 200 });
    },
  });
  await importer(new File(['video'], 'reference.mp4', { type: 'video/mp4' }));
  assert.equal(requests.length, 1);
  assert.equal(videos.get().length, 0);
  assert.equal(selected.get(), null);
});
