import assert from 'node:assert/strict';
import { test } from 'node:test';
import axios from 'axios';
import { publishInstagramReel } from '../integrations/social.js';

test('Instagram persists container before polling/publishing and fails closed on lost durable write', async () => {
  const original = { post: axios.post, get: axios.get };
  const calls: string[] = [];
  try {
    axios.post = (async (url: string) => { calls.push(url.endsWith('/media') ? 'create' : 'publish'); return { data: { id: url.endsWith('/media') ? 'container-1' : 'media-1' } }; }) as typeof axios.post;
    axios.get = (async () => { calls.push('poll'); return { data: { id: 'container-1', status_code: 'FINISHED' } }; }) as typeof axios.get;
    const input = { videoUrl: 'https://controlled.invalid/v.mp4', title: 'fixture' };
    await assert.rejects(publishInstagramReel('account', 'token', 'v25.0', input), /persistence_required/);
    assert.equal(calls.length, 0);
    await assert.rejects(publishInstagramReel('account', 'token', 'v25.0', input, { async onContainerCreated(id) { assert.equal(id, 'container-1'); calls.push('persist'); throw Error('durable write lost'); } }), /durable write lost/);
    assert.equal(calls.join(','), 'create,persist');
    calls.length = 0;
    const result = await publishInstagramReel('account', 'token', 'v25.0', input, { async onContainerCreated(id) { assert.equal(id, 'container-1'); calls.push('persist'); } });
    assert.equal(result.id, 'media-1');
    assert.equal(calls.join(','), 'create,persist,poll,publish');
    calls.length = 0;
    axios.post = (async (url: string) => ({ data: url.endsWith('/media') ? { id: 'container-1' } : {} })) as typeof axios.post;
    await assert.rejects(publishInstagramReel('account', 'token', 'v25.0', input, { async onContainerCreated() {} }), /最终媒体 ID/);
  } finally { Object.assign(axios, original); }
});
