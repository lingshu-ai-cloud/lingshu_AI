/** Run the actual Studio script route with real text generation and local-only sample state.
 * Usage: tsx scripts/preview-studio-scripts.ts input.json output-directory
 * Never imports server/index.ts: no workers, publishing, migrations or database writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import dotenv from 'dotenv';
import express from 'express';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

const [inputFile, outputDirectory] = process.argv.slice(2);
if (!inputFile || !outputDirectory) throw new Error('Usage: tsx scripts/preview-studio-scripts.ts input.json output-directory');
if (process.env.NODE_ENV === 'production') throw new Error('Local preview only');
for (const file of ['.env', path.join(os.homedir(), '.config/lingshu-ai/.env'), path.join(os.homedir(), '.config/lingshu-ai/.env.local'), '.env.local']) {
  if (fs.existsSync(file)) dotenv.config({ path: file, quiet: true, override: file === '.env.local' });
}
if (process.env.NODE_ENV === 'production') throw new Error('Local preview only');
if (process.env.PREVIEW_SCRIPT_BACKEND) process.env.STUDIO_SCRIPT_BACKEND = process.env.PREVIEW_SCRIPT_BACKEND;
const previewBackend = process.env.STUDIO_SCRIPT_BACKEND === 'gemini' ? 'gemini' : 'qwen';
if (previewBackend === 'gemini' ? !process.env.GEMINI_API_KEY : !process.env.DASHSCOPE_API_KEY) throw new Error(`${previewBackend} API key is required; no template fallback`);
process.env.DEMO_MODE = 'false';
process.env.SUBSCRIPTION_ENFORCED = 'false';
process.env.NO_PROXY = [process.env.NO_PROXY, 'localhost', '127.0.0.1'].filter(Boolean).join(',');
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) setGlobalDispatcher(new EnvHttpProxyAgent());
const input = JSON.parse(fs.readFileSync(inputFile, 'utf8')) as Record<string, unknown>;
if (!String(input.productInfo || '').trim()) throw new Error('Product facts are required');
const outputDir = path.resolve(outputDirectory);
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'input.json'), JSON.stringify(input, null, 2));

const modelCalls: Record<string, unknown>[] = [];
const realFetch = globalThis.fetch;
const providerOrigin = new URL(process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').origin;
globalThis.fetch = async (resource, init) => {
  const url = resource instanceof Request ? resource.url : String(resource);
  // Explicit local experiments only; never change persisted/provider-wide settings.
  if (url.startsWith(providerOrigin + '/') && url.includes('/chat/completions') && typeof init?.body === 'string') {
    const request = JSON.parse(init.body);
    if (process.env.PREVIEW_QWEN_MODEL) request.model = process.env.PREVIEW_QWEN_MODEL;
    if (process.env.PREVIEW_QWEN_THINKING === 'true' || process.env.PREVIEW_QWEN_THINKING === 'false') {
      request.enable_thinking = process.env.PREVIEW_QWEN_THINKING === 'true';
      if (request.enable_thinking) request.thinking_budget = 2048;
    }
    init = { ...init, body: JSON.stringify(request) };
  }
  const response = await realFetch(resource, init);
  if (url.startsWith(providerOrigin + '/') && url.includes('/chat/completions')) {
    const request = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    const data = await response.clone().json().catch(() => ({})) as Record<string, any>;
    modelCalls.push({ model: data.model || request.model, enableThinking: request.enable_thinking, thinkingBudget: request.thinking_budget, status: response.status, usage: data.usage,
      prompt: request.messages?.filter((m: any) => m.role === 'user').map((m: any) => m.content).join('\n'),
      output: data.choices?.[0]?.message?.content, finishReason: data.choices?.[0]?.finish_reason });
  } else if (url.startsWith('https://generativelanguage.googleapis.com/') && url.includes(':generateContent')) {
    const request = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    const data = await response.clone().json().catch(() => ({})) as Record<string, any>;
    modelCalls.push({ model: data.modelVersion || process.env.GEMINI_MODEL || 'gemini-2.5-flash', status: response.status, usage: data.usageMetadata,
      prompt: request.contents?.flatMap((item: any) => item.parts || []).map((part: any) => part.text || '').join('\n'),
      output: data.candidates?.[0]?.content?.parts?.filter((part: any) => !part.thought).map((part: any) => part.text || '').join(''),
      finishReason: data.candidates?.[0]?.finishReason });
  }
  return response;
};
// Isolated local identity and empty store; the real route and provider stay intact.
const { auth, store } = await import('../server/storage/index.js');
const token = randomUUID();
auth.verifyToken = async header => header === `Bearer ${token}` ? { userId: 'local-script-preview', tenantId: 'local_tenant_admin_script_preview' } : null;
store.list = async () => ({ items: [], page: 1, perPage: 20, totalItems: 0, totalPages: 0 });
store.create = async () => { throw new Error('Preview cannot write business data'); };
store.update = async () => { throw new Error('Preview cannot write business data'); };
const { studioRouter } = await import('../server/routes/studio.js');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => { if (req.method === 'POST' && req.path === '/studio/script') next(); else res.sendStatus(404); });
app.use('/studio', studioRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Preview server unavailable');
const { previewCases, ...baseInput } = input;
const cases = Array.isArray(previewCases) && previewCases.length > 0 ? previewCases.slice(0, 3) : [{}, {}, {}];
const versions: Record<string, any>[] = [];
try {
  for (let index = 0; index < cases.length; index += 1) {
    const started = Date.now();
    const modelCallStart = modelCalls.length;
    console.log(`Generating version ${index + 1}/${cases.length} with the real Studio route...`);
    let status = 0;
    let result: Record<string, any>;
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/studio/script`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...baseInput, ...cases[index], existingScripts: versions.filter(v => v.ok && v.script).map(v => v.script), variantSeed: index }),
        signal: AbortSignal.timeout(240_000),
      });
      status = response.status;
      result = await response.json() as Record<string, any>;
    } catch (error) {
      result = { ok: false, script: '', qualityStatus: 'failed', source: 'preview_transport_error',
        error: error instanceof Error ? error.message.slice(0, 250) : 'Preview transport failed' };
    }
    const version = { version: index + 1, inputCase: cases[index], httpStatus: status, elapsedMs: Date.now() - started,
      modelCallRange: [modelCallStart, modelCalls.length], ...result };
    versions.push(version);
    fs.writeFileSync(path.join(outputDir, `version-${index + 1}.json`), JSON.stringify(version, null, 2));
    fs.writeFileSync(path.join(outputDir, `version-${index + 1}.txt`), result.script || '');
    console.log(`Version ${index + 1}: HTTP ${status}, ${result.qualityStatus}, ${version.elapsedMs}ms`);
    if (status < 200 || status >= 300 || !result.script) process.exitCode = 1; // Preserve failed cases and continue the comparison.
  }
} finally {
  fs.writeFileSync(path.join(outputDir, 'model-calls.json'), JSON.stringify(modelCalls, null, 2));
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(),
    source: `real_studio_route_${previewBackend}`, inputHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    modelCalls: modelCalls.length, versions: versions.map(({ script, ...v }) => v) }, null, 2));
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  globalThis.fetch = realFetch;
}
