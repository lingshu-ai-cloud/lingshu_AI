import test from 'node:test';
import assert from 'node:assert/strict';
import {Socket} from 'node:net';
import type {DataStore, ListQuery, ListResult} from '../storage/datastore.js';
import {createStarter198Repository} from './repository.js';

async function withoutTransport(run: () => Promise<void>) {
  const fetch = globalThis.fetch, connect = Socket.prototype.connect;
  let attempts = 0;
  globalThis.fetch = (async () => { attempts++; throw Error('material_authority_network_forbidden'); }) as typeof fetch;
  Socket.prototype.connect = function () { attempts++; throw Error('material_authority_network_forbidden'); } as typeof connect;
  try { await run(); assert.equal(attempts, 0, 'injected inventory must never fall back to global PB or PostgreSQL transport'); }
  finally { globalThis.fetch = fetch; Socket.prototype.connect = connect; }
}

test('repository inventory reads the injected store across pages and keeps tenant/shared access rules', async () => withoutTransport(async () => {
  const pages = [
    [{id:'owned',tenant_id:'tenant-a',scope:'own',title:'Owned material',objectKey:'owned.mp4'}, {id:'foreign',tenant_id:'tenant-b',scope:'own',title:'Foreign material',objectKey:'foreign.mp4'}],
    [{id:'shared',tenant_id:'tenant-b',scope:'shared',title:'Shared material',objectKey:'shared.mp4'}],
  ];
  const reads: number[] = [];
  const dataStore = {async list<T>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    assert.equal(collection, 'materials');
    const page = query.page ?? 1; reads.push(page);
    return {items: pages[page-1] as T[], totalItems:3, totalPages:2, page, perPage:500};
  }} as DataStore;
  const repository = createStarter198Repository(dataStore);
  const inventory = await repository.materialLibrary!('tenant-a', {local: () => []});
  assert.deepEqual(reads, [1,2]);
  assert.equal(inventory.status, 'ready');
  assert.deepEqual(inventory.items.map(item => item.id).sort(), ['pb-owned','pb-shared']);
}));

test('injected inventory failure stays unavailable rather than retrying another authority', async () => withoutTransport(async () => {
  let calls = 0;
  const dataStore = {async list() { calls++; throw Error('injected_inventory_unavailable'); }} as unknown as DataStore;
  const inventory = await createStarter198Repository(dataStore).materialLibrary!('tenant-a', {local: () => []});
  assert.equal(calls, 1);
  assert.equal(inventory.sources.find(source => source.source === 'database')?.state, 'unavailable');
  assert.notEqual(inventory.status, 'ready');
  assert.deepEqual(inventory.items, []);
}));

test('explicit trusted inventory reader retains precedence over the repository default', async () => withoutTransport(async () => {
  const dataStore = {async list() { throw Error('wrong_inventory_authority'); }} as unknown as DataStore;
  let calls = 0;
  const repository = createStarter198Repository(dataStore, {materialLibrary: async tenantId => {
    assert.equal(tenantId, 'tenant-a'); calls++;
    return {items:[],status:'ready',sources:[]};
  }});
  await repository.materialLibrary!('tenant-a');
  assert.equal(calls, 1);
}));
