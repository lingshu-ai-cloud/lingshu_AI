import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ShotProductionPanel from './ShotProductionPanel.js';
import { newShotProduction, EMPTY_DEFAULTS } from '../lib/shotProduction.js';

const props = {
  context: '', title: '第一镜', duration: 7, defaults: EMPTY_DEFAULTS, materials: [], products: [], jobs: [],
  reason: '优先真实素材', error: '', busy: false, configured: false, costPerSecond: null,
  onChange: () => {}, onClose: () => {}, onNarration: () => {}, onDefaults: async () => {}, onGenerate: () => {},
  onAi: () => {}, onShoot: () => {}, onMaterial: () => {}, onAdopt: () => {}, onRefresh: () => {},
};
test('failed media verification is not presented as a usable completed candidate', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} shot={{ ...newShotProduction(), source: 'avatar' }} jobs={[{ id: 'j1', projectId: 'p1', shotId: 's1', assemblyId: 'a1', fingerprint: 'f1', status: 'pending', error: '供应商已生成，但下载或技术检查未通过：缺少音轨', createdAt: '', updatedAt: '' }]} />);
  assert.match(html, /已生成 · 待入库核验/);
  assert.match(html, /技术通过不代表口型/);
  assert.doesNotMatch(html, /候选已就绪/);
});
test('avatar workflow separates precise speech, cinematic motion and transparent overlay', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} configured costPerSecond={0.6} singleTestCapCny={5} shot={{ ...newShotProduction('这是一段口播'), source: 'avatar' }} />);
  for (const label of ['精准口播 · 台词与口型优先', '运镜口播 · 4–15秒', '透明人物层 · 灵枢合成', '后期镜头运动（待合成接入）', '镜头 7.0 秒，配置估价约 ¥4.20']) assert.match(html, new RegExp(label));
  assert.match(html, /当前合成器尚未应用该参数/);
  assert.match(html, /单次口播测试预算准入上限 ¥5\.00/);
  assert.match(html, /创建照片形象/);
  assert.match(html, /创建视频分身（专家）/);
  assert.match(html, /上传完整真人视频训练 Digital Twin/);
});
test('cinematic mode states its integration boundary and cannot trigger billing', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} configured shot={{ ...newShotProduction('这是一段口播', 'person'), source: 'avatar', avatarMode: 'cinematic' }} />);
  assert.match(html, /Cinematic \/ Avatar Shots API 尚未接入/);
  assert.match(html, /当前镜头 7.0 秒；运镜口播要求 4–15 秒/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>等待接入运镜接口/);
});
test('unconfigured avatar cannot be billed and exposes all four source choices', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} capabilityReason="服务端未配置 HEYGEN_API_KEY" shot={{ ...newShotProduction('hello'), source: 'avatar' }} />);
  for (const label of ['已有素材', '数字人口播', 'AI创意画面', '安排真人拍摄', '连续旁白', '使用镜头原声', '此镜无声', '人物与产品分屏', '产品主画面', '用一句话编辑当前镜头']) assert.ok(html.includes(label));
  assert.match(html, /HeyGen未配置或未启用/);
  assert.match(html, /服务端未配置 HEYGEN_API_KEY/);
  assert.match(html, /提交结果未知时只核对原任务，不自动再次生成/);
  assert.match(html, /预算预占是调用准入控制，不等于供应商最终账单/);
  assert.match(html, /未配置单价，费用以供应商账单为准/);
  assert.match(html, /请生成并采用当前数字人镜头候选/);
  assert.match(html, /<form class="my-3 flex flex-wrap gap-2"/);
  assert.doesNotMatch(html, /<form class="[^"]*\bhidden\b/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>生成新候选/);
  assert.match(html, /role="dialog" aria-modal="true"/);
});
test('capability errors remain visible even when avatar generation is not configured', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} error="能力检查失败，请稍后重试" shot={{ ...newShotProduction('hello'), source: 'avatar' }} />);
  assert.match(html, /role="alert"[^>]*>能力检查失败，请稍后重试/);
});
test('locked shot disables editing and changed candidates cannot be adopted', () => {
  const shot = { ...newShotProduction(), locked: true, candidates: [{ id: 'old', materialId: 'm', source: 'material' as const, fingerprint: 'old', createdAt: '' }] };
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} shot={shot} />);
  assert.match(html, /<fieldset disabled=""/);
  assert.match(html, /要求已变化/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>采用 \/ 恢复/);
});
