import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

const primaryCta = '发送工件、节拍、缺陷样本或现场布局，预约一次 30 分钟英文方案诊断';
const modelStoryboard = Array.from({ length: 5 }, (_, index) => {
  const start = index * 4;
  const end = start + 4;
  const last = index === 4;
  return `[${start}-${end}s]
素材：Gigaset 气动输送带
环境：工厂
景别：中景
运镜：固定
构图：工件居中
镜头功能：${index === 0 ? '买家钩子' : last ? 'CTA' : '产品证据'}
画面：使用素材《Gigaset 气动输送带》，截取工件沿输送带移动的清晰位置
配乐：机械环境声
台词：无
字幕：${last ? primaryCta : index === 0 ? '采购和 Factory Automation Manager，怎么核对现场需求？' : '无'}`;
}).join('\n');

let providerCalls = 0;
const qwenStub = http.createServer((_req, res) => {
  providerCalls += 1;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    id: `quality-v2-${providerCalls}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'qwen-test',
    choices: [{ index: 0, message: { role: 'assistant', content: modelStoryboard }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
  }));
});
await new Promise<void>(resolve => qwenStub.listen(0, '127.0.0.1', resolve));
const providerAddress = qwenStub.address();
assert.ok(providerAddress && typeof providerAddress !== 'string');

process.env.DASHSCOPE_API_KEY = 'quality-route-test-key';
process.env.DASHSCOPE_BASE_URL = `http://127.0.0.1:${providerAddress.port}/v1`;
process.env.GEMINI_API_KEY = '';
process.env.SUBSCRIPTION_ENFORCED = 'false';
process.env.DEMO_MODE = 'false';

const { auth, store } = await import('../storage/index.js');
auth.verifyToken = async () => ({ userId: 'quality-route-user', tenantId: 'quality-route-tenant' });
store.list = (async collection => collection === 'tenant_profiles'
  ? ({
    items: [{
      id: 'quality-route-enterprise-profile',
      profile: {
        company: { name: 'LX 测试制造企业', companyType: '制造工厂' },
        products: { items: [{
          name: 'LX-Vision 工业视觉检测工作站',
          category: '工厂自动化',
          highlights: '可根据工件、节拍、缺陷样本或现场布局开展方案诊断',
        }] },
        socialStrategy: { enabledRoutes: ['oem_odm'] },
      },
    }],
    page: 1, perPage: 20, totalItems: 1, totalPages: 1,
  })
  : ({ items: [], page: 1, perPage: 20, totalItems: 0, totalPages: 0 })) as typeof store.list;
const { studioRouter } = await import('./studio.js');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/studio', studioRouter);
const apiServer = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => apiServer.once('listening', resolve));
const apiAddress = apiServer.address();
assert.ok(apiAddress && typeof apiAddress !== 'string');

try {
  const response = await fetch(`http://127.0.0.1:${apiAddress.port}/studio/script`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer route-test' },
    body: JSON.stringify({
      materials: ['Gigaset 气动输送带'],
      materialInfos: [{
        name: 'Gigaset 气动输送带',
        type: 'video',
        folder: 'factory',
        duration: 20,
        effectiveDuration: 4,
        targetStart: 0,
        targetEnd: 4,
        observations: ['0-4s；工件沿气动输送带移动；中景；固定；工厂'],
      }],
      productInfo: '产品名称：LX-Vision 工业视觉检测工作站\n所属类目：工厂自动化\n已核实事实：可根据工件、节拍、缺陷样本或现场布局开展方案诊断',
      language: 'zh',
      platform: 'tiktok',
      duration: 20,
      scriptType: 'storyboard',
      generationMode: 'material',
      cooperationRoute: 'oem_odm',
      voiceoverMode: 'none',
      audience: 'Factory Automation Manager、Engineering Manager、Plant Manager、Project Buyer',
      videoTheme: { id: 'buyer_pain', title: '买家痛点', primaryCta },
    }),
  });
  const body = await response.json() as {
    script?: string;
    qualityStatus?: string;
    validationWarnings?: string[];
    validationIssues?: string[];
    qualityChecks?: { materialCoverage?: { pendingScenes?: number; coverageRatio?: number } };
  };
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.qualityStatus, 'needs_material');
  assert.equal(body.qualityChecks?.materialCoverage?.pendingScenes, 4);
  assert.equal(body.qualityChecks?.materialCoverage?.coverageRatio, 0.2);
  assert.equal((body.script?.match(/^素材：待匹配素材$/gm) || []).length, 4);
  assert.match(body.script || '', new RegExp(`^字幕：${primaryCta}$`, 'm'));
  assert.doesNotMatch((body.validationIssues || []).join('\n'), /Factory Automation Manager.*品牌|Project Buyer.*设备/);
  assert.match((body.validationWarnings || []).join('\n'), /素材覆盖不足/);
  assert.ok(providerCalls >= 1);
} finally {
  await new Promise<void>(resolve => apiServer.close(() => resolve()));
  qwenStub.closeAllConnections();
  await new Promise<void>(resolve => qwenStub.close(() => resolve()));
}

console.log('studio quality route V2 tests passed');
