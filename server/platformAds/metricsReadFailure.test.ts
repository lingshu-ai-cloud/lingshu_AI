import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
class FixtureError extends Error { constructor(message: string, public code: string) { super(message); } }
const handlers = new Map<string, any>(), logs: any[] = [];
let failure: Error = new FixtureError('public provider diagnostic', 'NETWORK_ERROR');
const router = { use() {}, get(path: string, fn: any) { handlers.set(String(path), fn); } };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../routes/platformAdMetrics.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
  exports: {}, console: { warn: (...args: any[]) => logs.push(args) },
  require(name: string) {
    if (name === 'express') return { Router: () => router };
    if (name === 'node:crypto') return { randomUUID: () => 'fixture-trace' };
    if (name.includes('metaAdapter')) return { AdProviderError: FixtureError };
    if (name.endsWith('/metrics.js')) return { getAdTaskMetrics: async () => { throw failure; } };
    return {};
  },
});
let status = 0, body: any;
const response = { locals: { tenantId: 'fixture-tenant' }, status(value: number) { status = value; return this; }, json(value: any) { body = value; } };
await handlers.get('/tasks/:id/metrics')({ params: { id: 'fixture-task' } }, response);
assert.equal(status, 503); assert.equal(body.code, 'NETWORK_ERROR'); assert.equal(body.requestId, 'fixture-trace'); assert.equal(body.error, 'public provider diagnostic');
assert.equal(logs[0][1].requestId, body.requestId); assert.equal(logs[0][1].taskId, 'fixture-task');
failure = new Error('private server exception including secret fixture');
await handlers.get('/tasks/:id/metrics')({ params: { id: 'fixture-task' } }, response);
assert.equal(body.code, 'METRICS_UNAVAILABLE'); assert.equal(body.error, '投放效果暂不可用');
assert.ok(!JSON.stringify(logs).includes('secret')); assert.ok(!JSON.stringify(body).includes('secret'));
failure = new FixtureError('未找到投放任务', 'NOT_FOUND');
await handlers.get('/tasks/:id/metrics')({ params: { id: 'fixture-task' } }, response);
assert.equal(status, 404); assert.equal(body.code, 'NOT_FOUND');
console.log('metric failure correlation, stable codes and safe logs tests passed');
