import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

const partialProvider = http.createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const isThreeLanguageBatch = body.includes('Target languages:') && body.includes('- en:') && body.includes('- es:');
    const content = isThreeLanguageBatch
      ? JSON.stringify({
        es: '[0-3s] ¿Buscas mejorar vivienda? No mires solo el precio.\n[3-6.7s] Compara presupuesto, trayecto y espacio útil.\n[6.7-10.6s] Verifica cada dato antes de decidir.\n[10.6-15s] Escríbenos para comparar tres planos y presupuestos.',
      })
      : JSON.stringify({ lines: [] });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'partial-test', choices: [{ message: { role: 'assistant', content } }] }));
  });
});
await new Promise<void>(resolve => partialProvider.listen(0, '127.0.0.1', resolve));
const providerAddress = partialProvider.address();
assert.ok(providerAddress && typeof providerAddress !== 'string');

process.env.DASHSCOPE_API_KEY = 'translation-fallback-test-key';
process.env.DASHSCOPE_BASE_URL = `http://127.0.0.1:${providerAddress.port}/v1`;
process.env.GEMINI_API_KEY = '';
process.env.SUBSCRIPTION_ENFORCED = 'false';

const { auth } = await import('../storage/index.js');
auth.verifyToken = async () => ({ userId: 'translation-fallback-user', tenantId: 'translation-fallback-tenant' });
const { studioRouter } = await import('./studio.js');

const app = express();
app.use(express.json());
app.use('/studio', studioRouter);
const apiServer = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => apiServer.once('listening', resolve));
const address = apiServer.address();
assert.ok(address && typeof address !== 'string');

const standardSource = '[0-3s] 改善置业，别只看总价。\n[3-6.7s] 预算、通勤、空间三项一起比较。\n[6.7-10.6s] 房源条件逐项核实，判断才更稳。\n[10.6-15s] 私信领取三类户型与预算对比清单';

try {
  const batchResponse = await fetch(`http://127.0.0.1:${address.port}/studio/translate/batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: standardSource, source: 'zh', targets: ['en', 'es'] }),
  });
  const batch = await batchResponse.json() as {
    ok?: boolean;
    source?: string;
    translations?: Record<string, string>;
    translationSources?: Record<string, string>;
    fallbackLanguages?: string[];
    missingLanguages?: string[];
  };
  assert.equal(batch.ok, true);
  assert.equal(batch.source, 'mixed');
  assert.deepEqual(batch.translationSources, { es: 'ai', en: 'deterministic' });
  assert.deepEqual(batch.fallbackLanguages, ['en']);
  assert.deepEqual(batch.missingLanguages, []);
  assert.match(batch.translations?.en || '', /^\[0-3s\] Upgrading homes\?/);
  assert.match(batch.translations?.es || '', /^\[0-3s\] ¿Buscas mejorar vivienda\?/);

  const singleResponse = await fetch(`http://127.0.0.1:${address.port}/studio/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: standardSource, source: 'zh', target: 'en' }),
  });
  const single = await singleResponse.json() as { ok?: boolean; source?: string; text?: string };
  assert.equal(single.ok, true);
  assert.equal(single.source, 'deterministic');
  assert.match(single.text || '', /^\[0-3s\] Upgrading homes\?/);

  const genericResponse = await fetch(`http://127.0.0.1:${address.port}/studio/translate/batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '[0-3s] 任意文案', source: 'zh', targets: ['en'] }),
  });
  const generic = await genericResponse.json() as { ok?: boolean; source?: string; translations?: Record<string, string>; missingLanguages?: string[] };
  assert.equal(generic.ok, false);
  assert.equal(generic.source, 'partial');
  assert.deepEqual(generic.translations, {});
  assert.deepEqual(generic.missingLanguages, ['en']);
} finally {
  await new Promise<void>(resolve => apiServer.close(() => resolve()));
  await new Promise<void>(resolve => partialProvider.close(() => resolve()));
}

console.log('studio translation fallback route tests passed');
