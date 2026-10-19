import test from 'node:test';
import assert from 'node:assert/strict';
import { presenterApi } from './presenterApi';

test('upload reports real transfer progress and rejects timeout without submitting creation', async () => {
  const originalXHR = globalThis.XMLHttpRequest;
  const originalStorage = globalThis.localStorage;
  let calls = 0;
  let timeout = 0;
  let uploadUrl = '';
  class UploadXHR {
    upload: any = {};
    timeout = 0;
    ontimeout?: () => void;
    open(method: string, url: string) { calls++; uploadUrl = url; assert.equal(method, 'POST'); assert.match(url, /uploads.*requestId=original-request/); }
    setRequestHeader() {}
    send() {
      timeout = this.timeout;
      this.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 });
      this.upload.onload();
      this.ontimeout?.();
    }
  }
  globalThis.XMLHttpRequest = UploadXHR as any;
  globalThis.localStorage = { getItem: () => null } as any;
  try {
    const progress: number[] = [];
    await assert.rejects(presenterApi.upload(new File(['video'], 'person.webm', { type: 'video/webm;codecs=vp9,opus' }), 'original-request', undefined, undefined, true, percent => progress.push(percent)), /等待超时.*尚未提交人物创建/);
    assert.deepEqual(progress, [50, 100]);
    assert.equal(timeout, 420_000);
    assert.equal(calls, 1);
    assert.match(uploadUrl, /mime=video%2Fwebm/);
    assert.doesNotMatch(uploadUrl, /codecs/);
  } finally {
    globalThis.XMLHttpRequest = originalXHR;
    globalThis.localStorage = originalStorage;
  }
});
