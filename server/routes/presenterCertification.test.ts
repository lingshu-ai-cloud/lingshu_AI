import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { createProductionRouter } from './production.js';

function memoryStore(): DataStore {
  const rows = new Map<string, any>(); let sequence = 0;
  return {
    async getById<T>(collection: string, id: string) { return rows.get(`${collection}/${id}`) as T || null; },
    async create<T>(collection: string, value: Record<string, unknown>) { const row = { ...value, id: `r${++sequence}` }; rows.set(`${collection}/${row.id}`, row); return row as T; },
    async update(collection, id, patch) { const key = `${collection}/${id}`; if (!rows.has(key)) return false; rows.set(key, { ...rows.get(key), ...patch }); return true; },
    async delete(collection, id) { return rows.delete(`${collection}/${id}`); },
    async list<T>(collection: string, query: ListQuery = {}) { const items = [...rows.entries()].filter(([key, value]) => key.startsWith(`${collection}/`) && Object.entries(query.where || {}).every(([field, expected]) => value[field] === expected)).map(([, value]) => value as T); return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 500 }; },
  };
}

test('presenter certification keeps local upload, consent and Ark Active state separate', async () => {
  const bindings: any[] = []; const app = express(); app.use(express.json()); app.use((_req, res, next) => { res.locals.tenantId = 'tenant-a'; next(); });
  app.use(createProductionRouter(memoryStore(), async () => 'unused', { validatePresenterMaterials: async () => {}, bindArkAsset: async input => { bindings.push(input); } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const presenter = { id:'person-1', name:'真人一', avatarId:'', voiceId:'', authorized:true, supportsAlpha:false, referenceMaterialIds:['portrait-1'], arkCertification:{ projectName:'default', assetUri:'asset://asset-image-1', assetType:'image', status:'active', materialId:'portrait-1', verificationSource:'manual_console', manualConfirmation:{ imageTypeConfirmed:true,activeConfirmed:true,samePersonConfirmed:true,confirmedAt:'2026-10-04T00:00:00.000Z' } } };
  const body = { preference:'avatar', defaultPresenterId:'person-1', defaultSound:'voiceover', defaultLayout:'full', presenters:[presenter] };
  try {
    const rejected = await fetch(`${base}/defaults`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); assert.equal(rejected.status,400); assert.match((await rejected.json()).error,/主体授权/); assert.equal(bindings.length,0);
    const withRights = {...presenter,rightsEvidence:{authorizationRef:'auth-1',consentRef:'consent-1',grantedAt:'2026-09-25T00:00:00.000Z',subjectAdultConfirmed:true,permittedProviders:['volcengine_ark'],permittedUses:['digital_presenter','person_replacement']}};
    const unchecked = await fetch(`${base}/defaults`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ...body, presenters:[{...withRights,arkCertification:{...presenter.arkCertification,manualConfirmation:undefined}}] }) }); assert.equal(unchecked.status,400); assert.match((await unchecked.json()).error,/同一人/); assert.equal(bindings.length,0);
    const accepted = await fetch(`${base}/defaults`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ...body, presenters:[withRights] }) }); assert.equal(accepted.status,200); assert.equal(bindings.length,1); assert.equal(bindings[0].certification.status,'active');
    const rotated = await fetch(`${base}/defaults`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ...body, presenters:[{...withRights,arkCertification:{...presenter.arkCertification,assetUri:'asset://asset-image-2',manualConfirmation:undefined}}] }) }); assert.equal(rotated.status,400); assert.equal(bindings.length,1);
    const unavailable = await fetch(`${base}/presenters/ark-status`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({projectName:'default',assetUri:'asset://asset-image-1'}) }); assert.equal(unavailable.status,409); assert.match((await unavailable.json()).error,/控制台人工确认/);
  } finally { await new Promise<void>(resolve => server.close(()=>resolve())); }
});
