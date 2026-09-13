import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ShotProductionPanel from './ShotProductionPanel.js';
import { newShotProduction, EMPTY_DEFAULTS } from '../lib/shotProduction.js';

const props = {
  context: '', title: '第一镜', defaults: EMPTY_DEFAULTS, materials: [], products: [], jobs: [],
  reason: '优先真实素材', error: '', busy: false, configured: false, costPerSecond: null,
  onChange: () => {}, onClose: () => {}, onNarration: () => {}, onDefaults: async () => {}, onGenerate: () => {},
  onAi: () => {}, onShoot: () => {}, onMaterial: () => {}, onAdopt: () => {}, onRefresh: () => {},
};
test('failed media verification is not presented as a usable completed candidate', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} shot={newShotProduction()} jobs={[{ id: 'j1', projectId: 'p1', shotId: 's1', assemblyId: 'a1', fingerprint: 'f1', status: 'pending', error: '供应商已生成，但下载或技术检查未通过：缺少音轨', createdAt: '', updatedAt: '' }]} />);
  assert.match(html, /已生成 · 待入库核验/);
  assert.match(html, /技术通过不代表口型/);
  assert.doesNotMatch(html, /候选已就绪/);
});
test('unconfigured avatar cannot be billed and exposes all four source choices', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} shot={{ ...newShotProduction('hello'), source: 'avatar' }} />);
  for (const label of ['已有素材', '数字人口播', 'AI创意画面', '安排真人拍摄', '连续旁白', '使用镜头原声', '此镜无声', '人物与产品分屏', '产品主画面', '用一句话编辑当前镜头']) assert.ok(html.includes(label));
  assert.match(html, /HeyGen未配置或未启用/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>生成新候选/);
  assert.match(html, /role="dialog" aria-modal="true"/);
});
test('locked shot disables editing and changed candidates cannot be adopted', () => {
  const shot = { ...newShotProduction(), locked: true, candidates: [{ id: 'old', materialId: 'm', source: 'material' as const, fingerprint: 'old', createdAt: '' }] };
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} shot={shot} />);
  assert.match(html, /<fieldset disabled=""/);
  assert.match(html, /要求已变化/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>采用 \/ 恢复/);
});
