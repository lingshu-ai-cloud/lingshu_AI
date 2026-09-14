import { customerSuggestionsRouter } from './customerSuggestions.js';
import assert from 'node:assert/strict';
import express from 'express';
import { transitionOrder, updateAfterSales } from '../../shared/orderLifecycle.js';
import { enterpriseRouter } from './enterprise.js';
import { auth, store } from '../storage/index.js';
const pending = { status: '待付款' as const, amount: 100 };
assert.throws(() => transitionOrder(pending, 'typo'), /无效/);
assert.throws(() => transitionOrder(pending, '退款', 'receipt'), /不允许/);
assert.throws(() => transitionOrder(pending, '已付款'), /凭证/);
const paid = transitionOrder(pending, '已付款', 'bank-1');
assert.equal(paid.audit?.length, 1);
assert.deepEqual(transitionOrder(paid, '已付款', 'bank-1'), paid);
const refunded = transitionOrder(paid, '退款', 'refund-1');
assert.equal(refunded.status, '退款');
assert.throws(() => transitionOrder(refunded, '已付款', 'new'), /不允许/);
const opened = updateAfterSales({ afterSales: undefined }, 'open', 'damaged');
assert.throws(() => updateAfterSales(opened, 'open', 'again'), /未处理/);
assert.equal(updateAfterSales(opened, 'resolved', 'replacement').afterSales?.resolution, 'replacement');
const closed = updateAfterSales(opened, 'resolved', 'replacement');
assert.equal(updateAfterSales(closed, 'open', 'new problem').afterSalesHistory?.[0].resolution, 'replacement');
const original = { list: store.list, create: store.create, update: store.update, verify: auth.verifyToken };
const records: any[] = [];
store.list = (async (collection: string, opts: any) => {
  const items = records.filter(record => record.__collection === collection
    && Object.entries(opts.where || {}).every(([key, value]) => record[key] === value));
  return { items, totalPages: 1, totalItems: items.length };
}) as any;
store.create = (async (collection: string, value: any) => { const record = { ...value, id: `record-${records.length}`, __collection: collection }; records.push(record); return record; }) as any;
store.update = (async (collection: string, id: string, patch: any) => { const record = records.find(item => item.id === id && item.__collection === collection); if (!record) return false; Object.assign(record, patch); return true; }) as any;
auth.verifyToken = (async (header: string) => ({ tenantId: header === 'Bearer other' ? 'order-other' : 'order-isolation', userId: 'tester' })) as any;
const app = express(); app.use(express.json()); app.use('/customers', customerSuggestionsRouter); app.use(enterpriseRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
async function request(path: string, method: string, body?: any, token = 'self') {
  return fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
try {
  assert.equal((await request('/customers/legacy', 'PATCH', { orders: [] })).status, 422, 'legacy customer patch must not bypass order ledger');
  const payload = { orderNo: 'UNIQUE', buyer: 'Buyer', product: 'Switch', amount: 100, status: '待付款', sourcePostId: 'post-id' };
  const concurrent = await Promise.all([request('/orders', 'POST', payload), request('/orders', 'POST', payload)]);
  assert.deepEqual(concurrent.map(response => response.status).sort(), [201, 409]);
  const order = await concurrent.find(response => response.status === 201)!.json() as any;
  assert.equal(records.length, 1);
  assert.equal((await request(`/orders/${order.id}/status`, 'PATCH', { status: '已付款' })).status, 422);
  assert.equal((await request(`/orders/${order.id}/status`, 'PATCH', { status: '已付款', evidence: 'bank-1' }, 'other')).status, 404);
  const paidResponse = await request(`/orders/${order.id}/status`, 'PATCH', { status: '已付款', evidence: 'bank-1' });
  assert.equal(paidResponse.status, 200);
  assert.equal((await paidResponse.json() as any).audit.length, 1);
  assert.equal((await request(`/orders/${order.id}/aftersales`, 'PATCH', { status: 'open', text: 'damage' })).status, 200);
  assert.equal((await request(`/orders/${order.id}/aftersales`, 'PATCH', { status: 'resolved', text: 'refund recorded separately' })).status, 200);
  records[0].order.customerId = 'deleted-customer';
  const refund = await request(`/orders/${order.id}/status`, 'PATCH', { status: '退款', evidence: 'refund-bank-1' });
  const result = await refund.json() as any;
  assert.equal(refund.status, 200, 'projection failure must not report canonical order failure');
  assert.equal(result.customerSyncStatus, 'failed');
  assert.equal(records[0].order.customerSyncStatus, 'failed');
  assert.equal(result.refundAmount, 100); assert.equal(result.audit.length, 2);
  assert.equal(result.afterSales.status, 'resolved'); assert.equal(result.sourcePostId, 'post-id');
  const repeat = await request(`/orders/${order.id}/status`, 'PATCH', { status: '退款', evidence: 'refund-bank-1' });
  assert.equal((await repeat.json() as any).audit.length, 2);
  const csv = '订单号,客户,商品,GMV,状态\nUNIQUE,Buyer,Switch,100,待付款';
  const imported = await request('/orders/import', 'POST', { csv });
  assert.equal((await imported.json() as any).imported, 0);
  assert.equal(records[0].order.status, '退款');
  const keyed = { ...payload, orderNo: 'KEYED', idempotencyKey: 'stable-request-1' };
  assert.equal((await request('/orders', 'POST', keyed)).status, 201);
  const retried = await request('/orders', 'POST', keyed);
  assert.equal(retried.status, 200);
  assert.equal((await request('/orders', 'POST', { ...keyed, amount: 200 })).status, 409);
  assert.equal(records.length, 2, 'retry stable request must not create duplicate order');
  assert.equal((await request('/orders', 'POST', { ...payload, orderNo: 'FOREIGN', customerId: 'other-customer' })).status, 422);
  console.log('order lifecycle/API isolation passed: concurrent create, state validation, tenant boundary, payment/refund evidence, aftersales and import preservation');
} finally {
  Object.assign(store, { list: original.list, create: original.create, update: original.update }); auth.verifyToken = original.verify;
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
}
