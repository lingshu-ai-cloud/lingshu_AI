import assert from 'node:assert/strict';
import express from 'express';

const productName = 'LX-Vision 工业视觉检测工作站';
const sceneTimes = [0, 3, 7, 11, 15, 20];
const script = Array.from({ length: 5 }, (_, index) => {
  const start = sceneTimes[index]!;
  const speech = index === 0 ? `先看这段输送画面，再说 ${productName}。` : index === 4
    ? '带上工件、节拍和缺陷样本，预约方案诊断。'
    : `第 ${index + 1} 段需要匹配能证明产品信息的画面。`;
  return `[${start}-${sceneTimes[index + 1]}s]\n素材：${index === 0 ? '开场输送带' : '待匹配素材'}\n环境：工厂\n景别：中景\n运镜：固定\n构图：工件居中\n镜头功能：${index === 0 ? '买家钩子' : '产品证据'}\n画面：${index === 0 ? '工件沿输送带移动' : '待匹配素材；需补充能够证明本段信息的实际画面'}\n配乐：轻节奏\n台词：${speech}\n字幕：${speech}`;
}).join('\n\n');
let modelScript = script;

const originalFetch = globalThis.fetch;
let geminiCalls = 0;
const geminiRequests: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.includes('generativelanguage.googleapis.com')) {
    geminiCalls += 1;
    geminiRequests.push(String(init?.body || ''));
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: modelScript }] }, finishReason: 'STOP' }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  return originalFetch(input, init);
}) as typeof fetch;

process.env.GEMINI_API_KEY = 'free-creation-test-key';
process.env.SUBSCRIPTION_ENFORCED = 'false';
process.env.DEMO_MODE = 'false';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';

const { auth, store } = await import('../storage/index.js');
const { bindDataAuthority, dataAuthorityRequestScope } = await import('../storage/dataAuthority.js');
auth.verifyToken = async () => {
  bindDataAuthority('local');
  return { userId: 'free-creation-test-user', tenantId: 'local_tenant_free_creation', dataAuthority: 'local' };
};
store.list = (async collection => collection === 'tenant_profiles'
  ? ({ items: [{ id: 'free-creation-profile', profile: {
      company: { name: 'LX 测试制造企业', companyType: '制造工厂' },
      products: { items: [{ name: productName, category: '工厂自动化', highlights: '可根据工件、节拍、缺陷样本或现场布局开展方案诊断' }] },
      socialStrategy: { enabledRoutes: ['oem_odm'] },
    } }], page: 1, perPage: 20, totalItems: 1, totalPages: 1 })
  : ({ items: [], page: 1, perPage: 20, totalItems: 0, totalPages: 0 })) as typeof store.list;

const { studioRouter } = await import('./studio.js');
const app = express();
app.use(dataAuthorityRequestScope);
app.use(express.json());
app.use('/studio', studioRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');

try {
  const request = {
    materials: ['开场输送带'], materialInfos: [{ name: '开场输送带', type: 'video', folder: 'upload', duration: 8,
      effectiveDuration: 3, targetStart: 0, targetEnd: 3, role: '用户指定开场钩子',
      observations: ['工件沿输送带移动；中景；固定；工厂'] }],
    productInfo: productName, language: 'zh', platform: 'tiktok', duration: 20, scriptType: 'storyboard',
    generationMode: 'material', voiceoverMode: 'ai', provider: 'gemini', cooperationRoute: 'oem_odm',
  };
  const submit = () => originalFetch(`http://127.0.0.1:${address.port}/studio/script`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer free-creation-test' },
    body: JSON.stringify(request),
  });
  const response = await submit();
  const body = await response.json() as { ok?: boolean; qualityStatus?: string; publishable?: boolean; script?: string; error?: string };
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.qualityStatus, 'passed');
  assert.equal(body.publishable, true);
  assert.match(body.script || '', /台词：/);
  assert.match(body.script || '', /^素材：开场输送带$/m);
  assert.ok((body.script?.match(/^素材：待匹配素材$/gm) || []).length >= 1, 'later scenes must remain unassigned until shot production');
  assert.ok(geminiCalls > 0, 'the free creation script must call Gemini');
  assert.ok(geminiRequests.some(request => request.includes('指定开场钩子素材名')), 'the special opening-hook prompt must be used');

  modelScript = script.replace('[0-3s]', '[0-4s]');
  const invalidResponse = await submit();
  const invalidBody = await invalidResponse.json() as { code?: string; error?: string };
  assert.equal(invalidResponse.status, 422);
  assert.equal(invalidBody.code, 'SCRIPT_QUALITY_BLOCKED');
  assert.match(invalidBody.error || '', /开场第一镜/);
} finally {
  globalThis.fetch = originalFetch;
  await new Promise<void>(resolve => server.close(() => resolve()));
}

console.log('free creation Gemini route integration passed');
