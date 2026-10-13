import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import EnterprisePresenters from './EnterprisePresenters.js';

const source = readFileSync(new URL('./EnterprisePresenters.tsx', import.meta.url), 'utf8');
const enterprisePageSource = readFileSync(new URL('../EnterprisePage.tsx', import.meta.url), 'utf8');

test('initial configuration presents one unified presenter onboarding instead of duplicate provider forms', () => {
  const html = renderToStaticMarkup(<EnterprisePresenters initialConfiguration />);
  assert.match(html, /数字人统一接入/);
  assert.match(html, /人物、声音与本人认证/);
  assert.match(html, /开始统一接入/);
  assert.doesNotMatch(html, /HeyGen 口播接入/);
  assert.doesNotMatch(html, /方舟人物认证/);
  assert.match(source, /<ArkPresenterEnrollmentPanel/);
  assert.match(source, /productionApi\.startArkEnrollment/);
  assert.match(source, /productionApi\.uploadArkMaterial/);
  assert.match(source, /finishUnifiedPresenterSetup/);
  assert.match(source, /initialPhotoMaterialId=\{preparedArk\?\.photoMaterialId\}/);
});

test('enterprise presenter page is limited to editing and revoking existing people', () => {
  const html = renderToStaticMarkup(<EnterprisePresenters />);
  assert.match(html, /人物与出镜/);
  assert.match(html, /只维护已接入人物/);
  assert.match(source, />修改人物</);
  assert.match(source, />取消授权</);
  assert.match(source, /presenterApi\.revoke/);
  assert.doesNotMatch(source, /默认出镜偏好|新分镜默认声音|新分镜默认布局|主体授权证据|方舟控制台人工核验|渠道与出镜策略/);
  assert.match(enterprisePageSource, /enterpriseArea !== 'appearance' && <section[^>]+aria-label="企业资料完整度"/);
  assert.match(enterprisePageSource, /enterpriseArea !== 'appearance' && <div className=\{`rounded-lg border p-4/);
  assert.doesNotMatch(enterprisePageSource, /<EnterprisePresenterRouting/);
});

test('content production redirects setup to the shared beginner guide', () => {
  const html = renderToStaticMarkup(<EnterprisePresenters contentProduction />);
  assert.match(html, /打开数字人接入/);
  assert.match(html, /制作页面不再重复承载人物供应商配置/);
  assert.match(source, /lingshu:open-digital-employee-guide/);
  assert.match(source, /step: 'presenter'/);
});

test('all presenter mutations invalidate assistant decisions immediately', () => {
  assert.match(source, /notifyPresenterAssetsUpdated\(\)/);
  assert.match(source, /setValue\(next\); notifyPresenterAssetsUpdated\(\); setShowHeyGenManager/);
  assert.match(source, /onSaved=\{\(next, context\) => finishUnifiedPresenterSetup\(next, context\)\}/);
  assert.match(source, /setValue\(next\); notifyPresenterAssetsUpdated\(\); setMessage\('人物授权已取消/);
});
