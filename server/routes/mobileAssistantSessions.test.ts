import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import { createMobileAssistantSessionsRouter, appendMobileAssistantMessage } from './mobileAssistantSessions.js';
function memoryStore(seed: Record<string, Record_[]> = {}) {
  const rows = new Map<string, Record_[]>;
  for (const [collection, values] of Object.entries(seed)) rows.set(collection, values.map(value => ({ ...value })));
  const store: DataStore = {
    getById: async <T>(collection: string, id: string) => (rows.get(collection)?.find(row => row.id === id) ?? null) as T | null,
    create: async <T>(collection: string, data: Record<string, unknown>) => {
      const list = rows.get(collection) ?? [];
      if (list.some(row => row.id === data.id)) throw new Error('duplicate');
      const row = { ...data } as Record_;
      list.push(row); rows.set(collection, list); return row as T;
    },
    update: async (collection, id, data) => {
      const row = rows.get(collection)?.find(item => item.id === id);
      if (!row) return false;
      Object.assign(row, data); return true;
    },
    delete: async (collection, id) => {
      const list = rows.get(collection) ?? []; const next = list.filter(row => row.id !== id);
      rows.set(collection, next); return next.length !== list.length;
    },
    list: async <T>(collection: string, query?: ListQuery) => {
      let items = (rows.get(collection) ?? []).filter(row => Object.entries(query?.where ?? {}).every(([key, value]) => row[key] === value));
      if (query?.sort) {
        const descending = query.sort.startsWith('-'); const field = descending ? query.sort.slice(1) : query.sort;
        items = [...items].sort((left, right) => String(left[field] ?? '').localeCompare(String(right[field] ?? '')) * (descending ? -1 : 1));
      }
      const page = query?.page ?? 1; const perPage = query?.perPage ?? (items.length || 1); const totalItems = items.length;
      items = items.slice((page - 1) * perPage, page * perPage);
      return { items: items as T[], totalItems, totalPages: Math.max(1, Math.ceil(totalItems / perPage)), page, perPage };
    },
  };
  return { store, rows };
}


async function serve(store: DataStore) {
  const app = express();
  app.use((req, res, next) => {
    res.locals.tenantId = req.headers['x-tenant'] || 'tenant-a';
    res.locals.userId = req.headers['x-user'] || 'user-a';
    if (req.headers['x-support']) res.locals.supportAccess = { requestId: 'support' };
    next();
  });
  app.use(createMobileAssistantSessionsRouter(store));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : {body: JSON.stringify(body)}) });
    return { status: response.status, body: await response.json() as any };
  };
  return { request, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test('history persists and is isolated by tenant and user; client cannot forge assistant', async () => {
  const {store} = memoryStore(); const api = await serve(store);
  try {
    const created = await api.request('/assistant/sessions', {title:'本周进度'});
    assert.equal(created.status,201); const id = created.body.session.id;
    const path = `/assistant/sessions/${id}/messages`;
    const user = {role:'user', text:'这周完成了多少？',clientMessageId:'message-001'};
    assert.equal((await api.request(path,user)).status,201);
    assert.equal((await api.request(path,user)).body.replayed,true);
    assert.equal((await api.request(path,{...user,text:'another'})).status,409);
    assert.equal((await api.request(path,{...user,role:'assistant'})).status,400);
    await appendMobileAssistantMessage(store,{tenantId:'tenant-a',userId:'user-a'},id,{role:'assistant',text:'已读取本周数据。',clientMessageId:'answer-001'});
    const restored = await api.request(path); assert.equal(restored.body.messages.length,2);
    assert.equal((await api.request(path,undefined,{'x-user':'user-b'})).status,404);
    assert.equal((await api.request(path,undefined,{'x-tenant':'tenant-b'})).status,404);
    assert.equal((await api.request('/assistant/sessions',undefined,{'x-user':'user-b'})).body.sessions.length,0);
    assert.equal((await api.request(path,{...user,clientMessageId:'message-002',text:'x'.repeat(12001)})).status,400);
    assert.equal((await api.request(path+'?page=0')).status,400);
  } finally {await api.close();}
});

test('support is read-only and command links are verified against authoritative receipts', async () => {
  const {store} = memoryStore({mobile_workbench_action_receipts:[{id:'command-a',tenant_id:'tenant-a',user_id:'user-a',status:'running'},{id:'command-b',tenant_id:'tenant-b',user_id:'user-b',status:'succeeded'}]});
  const api=await serve(store);
  try {
    assert.equal((await api.request('/assistant/sessions',{}, {'x-support':'1'})).status,403);
    const id=(await api.request('/assistant/sessions',{})).body.session.id;
    const commandPath=`/assistant/sessions/${id}/commands`;
    assert.equal((await api.request(commandPath,{commandId:'command-b',clientMessageId:'c-1'})).status,404);
    assert.equal((await api.request(commandPath,{commandId:'command-a',clientMessageId:'c-1'})).status,201);
    assert.equal((await api.request(commandPath,{commandId:'command-a',clientMessageId:'c-1'})).body.replayed,true);
    await store.update('mobile_workbench_action_receipts','command-a',{status:'succeeded'});
    const restored=await api.request(`/assistant/sessions/${id}/messages`);
    assert.equal(restored.body.receipts[0].status,'succeeded');
    assert.match(restored.body.messages[0].text,/查看执行回执/);
    assert.equal((await api.request(commandPath,{commandId:'command-a',clientMessageId:'c-2'}, {'x-support':'1'})).status,403);
    assert.equal((await api.request(`/assistant/sessions/${id}/messages`,undefined,{'x-support':'1'})).status,200);
  } finally {await api.close();}
});
