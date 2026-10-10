import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { createPresenterAssetsRouter } from './presenterAssets.js';
import { HeyGenPresenterClient } from '../lib/heygenPresenters.js';

test('private voices can be listed, cloned and bound only for the owning tenant', async () => {
  const original = process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID;
  process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID = 'tenant-a';
  const rows = new Map<string, any>(); let sequence = 0; let clones = 0;
  const store: DataStore = {
    async getById<T>(collection: string, id: string) { return rows.get(`${collection}/${id}`) as T || null; },
    async create<T>(collection: string, value: Record<string, unknown>) { const row = { ...value, id: `r${++sequence}` }; rows.set(`${collection}/${row.id}`, row); return row as T; },
    async update(collection, id, patch) { const key = `${collection}/${id}`; if (!rows.has(key)) return false; rows.set(key, { ...rows.get(key), ...patch }); return true; },
    async delete(collection, id) { return rows.delete(`${collection}/${id}`); },
    async list<T>(collection: string, query: ListQuery = {}) { const items = [...rows.entries()].filter(([key,value]) => key.startsWith(`${collection}/`) && Object.entries(query.where || {}).every(([field,expected]) => value[field] === expected)).map(([,value]) => value as T); return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 500 }; },
  };
  await store.create('studio_production_defaults', { tenant_id:'tenant-a', payload:{ preference:'avatar', presenters:[{ id:'person-1', name:'销售', authorized:true, avatarId:'', voiceId:'', referenceMaterialIds:['photo-1'], assetVersion:1 }], defaultPresenterId:'person-1' } });
  const client = new HeyGenPresenterClient('test');
  client.voices = async (_token, _language, scope) => ({ items: scope === 'private' ? [{ id:'old-voice', name:'已有音色', language:'Chinese' }, ...(clones ? [{ id:'cloned-voice', name:'新音色', language:'Chinese' }] : [])] : [], nextToken:'' });
  client.voice = async id => ({ id, name:id === 'cloned-voice' ? '新音色' : '已有音色', language:'Chinese', status:'complete', type:'private' });
  client.cloneVoice = async () => { clones++; return 'cloned-voice'; };
  const app = express(); app.use(express.json()); app.use((req,res,next) => { res.locals.tenantId = String(req.headers['x-tenant'] || 'tenant-a'); next(); });
  app.use(createPresenterAssetsRouter(store, async (_key, action) => action(), { client }));
  const server = app.listen(0,'127.0.0.1'); await new Promise<void>(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const audio = Buffer.alloc(12_000, 1); Buffer.from([26,69,223,163]).copy(audio);
  try {
    const denied = await fetch(`${base}/voices?scope=private`, { headers:{'x-tenant':'tenant-b'} }); assert.equal(denied.status,503);
    const listed = await fetch(`${base}/voices?scope=private`); assert.equal(listed.status,200); assert.equal((await listed.json()).items[0].name,'已有音色');
    const cloneUrl = `${base}/voices/clones?name=${encodeURIComponent('新音色')}&language=zh&requestId=voice-request-1&consent=true`;
    const noConsent = await fetch(cloneUrl.replace('&consent=true',''),{method:'POST',headers:{'Content-Type':'audio/webm'},body:audio}); assert.equal(noConsent.status,400);
    const badAudio = await fetch(cloneUrl,{method:'POST',headers:{'Content-Type':'audio/webm'},body:Buffer.alloc(12_000,1)}); assert.equal(badAudio.status,400); assert.equal(clones,0);
    const first = await fetch(cloneUrl,{method:'POST',headers:{'Content-Type':'audio/webm'},body:audio}); assert.equal(first.status,202,await first.clone().text()); const job=await first.json();
    const duplicate = await fetch(cloneUrl,{method:'POST',headers:{'Content-Type':'audio/webm'},body:audio}); assert.equal(duplicate.status,202); assert.equal(clones,1);
    const status = await fetch(`${base}/voices/clones/${job.id}`); assert.equal((await status.json()).status,'completed');
    const otherStatus = await fetch(`${base}/voices/clones/${job.id}`,{headers:{'x-tenant':'tenant-b'}}); assert.equal(otherStatus.status,400);
    const bound = await fetch(`${base}/voices/bind`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({presenterId:'person-1',voiceId:'cloned-voice',voiceAuthorized:true})});
    assert.equal(bound.status,200,await bound.clone().text()); const boundPresenter=(await bound.json()).defaults.presenters[0]; assert.equal(boundPresenter.voiceId,'cloned-voice'); assert.equal(boundPresenter.voiceAuthorization.voiceId,'cloned-voice');
    const rejected = await fetch(`${base}/voices/bind`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({presenterId:'person-1',voiceId:'public-voice',voiceAuthorized:true})}); assert.equal(rejected.status,400);
  } finally { await new Promise<void>(resolve => server.close(()=>resolve())); if (original === undefined) delete process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID; else process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID=original; }
});
