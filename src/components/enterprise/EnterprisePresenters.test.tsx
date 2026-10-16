import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import EnterprisePresenters from './EnterprisePresenters.js';

const source = readFileSync(new URL('./EnterprisePresenters.tsx', import.meta.url), 'utf8');
const arkPanelSource = readFileSync(new URL('../studio/ArkPresenterEnrollmentPanel.tsx', import.meta.url), 'utf8');
const enterprisePageSource = readFileSync(new URL('../EnterprisePage.tsx', import.meta.url), 'utf8');

test('initial configuration presents one unified presenter onboarding instead of duplicate provider forms', () => {
  const html = renderToStaticMarkup(<EnterprisePresenters initialConfiguration />);
  assert.match(html, /数字人统一接入/);
  assert.match(html, /正在读取数字人配置/);
  assert.doesNotMatch(html, /待配置/);
  assert.match(source, /!loaded \? loadError[\s\S]{0,900}<LsLoadingState loading label="正在读取数字人配置"/);
  assert.match(source, /数字人生产准备/);
  assert.match(source, /1\. 选择数字人/);
  assert.match(source, /2\. 录入声音/);
  assert.match(source, /3\. 完成平台认证/);
  assert.match(source, /selectedPresenterSelected \? '更换数字人' : '选择数字人'/);
  assert.match(source, /录入本人声音/);
  assert.match(source, /voiceOnlyPresenter=\{selectedPresenter\}/);
  assert.match(source, /完成双平台认证/);
  assert.doesNotMatch(html, /HeyGen 口播接入/);
  assert.doesNotMatch(html, /方舟人物认证/);
  assert.match(source, /<ArkPresenterEnrollmentPanel/);
  assert.match(source, /productionApi\.startArkEnrollment/);
  assert.match(source, /productionApi\.uploadArkMaterial/);
  assert.match(source, /finishUnifiedPresenterSetup/);
  assert.match(source, /selectedPresenter\?\.referenceMaterialIds/);
  assert.match(source, /fetchMaterialLibrary\('all'\)/, '人物管理必须从私有完整库存恢复认证资料，不能依赖“我的素材”公开列表');
  assert.match(source, /preparedArk\?\.presenterId === selectedPresenter\?\.id/);
  assert.match(source, /presenterApi\.creations\(\)\.catch\(\(\) => \[\]\)/);
  assert.match(source, /document:\\\/\\\/studio_presenter_assets/);
  assert.match(source, /creationPreparations\[selectedCreationId\]/);
  assert.match(source, /\.reverse\(\)/);
  assert.match(source, /reusablePhotoMaterialId = selectedPreparedArk\?\.photoMaterialId/);
  assert.match(source, /reusableVideoMaterialId = selectedPreparedArk\?\.videoMaterialId/);
  assert.match(source, /initialPhotoMaterialId=\{reusablePhotoMaterialId\}/);
  assert.match(source, /initialVideoMaterialId=\{reusableVideoMaterialId\}/);
  assert.match(arkPanelSource, /已复用统一接入时上传的照片和本人视频，不需要再次录入/);
  assert.match(arkPanelSource, /!reusedMaterials &&/);
  assert.match(arkPanelSource, /reusedMaterials \? '开始人物认证' : '提交人物资料并开始认证'/);
  assert.match(source, /三项全部完成后才能进入生产/);
  assert.match(source, /selectedPresenterSetupReady/);
  assert.doesNotMatch(source, /人物替换认证是可选能力|高级人物替换为可选功能/);
  assert.match(source, /className="min-h-11 text-xs"/);
  assert.match(source, /authorizationConfirmed=\{false\}/);
  assert.doesNotMatch(source, /arkCapability = await productionApi\.arkEnrollmentCapabilities/);
  assert.match(arkPanelSource, /if \(!capability\.ready\)/);
  assert.match(arkPanelSource, /当前无法完成数字人生产准备/);
  assert.match(arkPanelSource, /管理员还需配置/);
  assert.doesNotMatch(arkPanelSource, /人物替换认证（可选）/);
});

test('enterprise presenter recovery persists its intent and lets the visible digital employee page open the dialog', () => {
  assert.match(source, /sessionStorage\.setItem\('lingshu:open-digital-employee-guide', 'presenter'\)/);
  assert.match(source, /CustomEvent\('lingshu:navigate', \{ detail: \{ page: 'digitalEmployees' \} \}\)/);
  assert.doesNotMatch(source, /requestAnimationFrame|setTimeout/);
});

test('enterprise presenter page supports editing, required certification and revoking existing people', () => {
  const html = renderToStaticMarkup(<EnterprisePresenters />);
  assert.match(html, /人物与出镜/);
  assert.match(html, /补全声音和方舟认证/);
  assert.match(source, />修改人物</);
  assert.match(source, /certificationOpen \? '收起认证' : '完成方舟认证'/);
  assert.match(source, />取消授权</);
  assert.match(source, /presenterApi\.revoke/);
  assert.doesNotMatch(source, /默认出镜偏好|新分镜默认声音|新分镜默认布局|主体授权证据|方舟控制台人工核验|渠道与出镜策略/);
  assert.match(enterprisePageSource, /enterpriseArea === 'facts' && <section[^>]+aria-label="企业资料完整度"/);
  assert.doesNotMatch(enterprisePageSource, /设置客服边界|打开灵小枢快速采集/);
  assert.match(enterprisePageSource, /<Collapse[\s\S]{0,500}enterprise-advanced-collapse/);
  assert.doesNotMatch(enterprisePageSource, /<EnterprisePresenterRouting/);
});

test('content production redirects setup to the shared beginner guide', () => {
  const html = renderToStaticMarkup(<EnterprisePresenters contentProduction />);
  assert.match(html, /打开数字人接入/);
  assert.match(html, /制作页面不再重复承载人物供应商配置/);
  assert.match(source, /lingshu:open-digital-employee-guide/);
  assert.match(source, /setItem\('lingshu:open-digital-employee-guide', 'presenter'\)/);
});

test('all presenter mutations invalidate assistant decisions immediately', () => {
  assert.match(source, /notifyPresenterAssetsUpdated\(\)/);
  assert.match(source, /setValue\(next\); notifyPresenterAssetsUpdated\(\); setShowHeyGenManager/);
  assert.match(source, /onSaved=\{\(next, context\) => finishUnifiedPresenterSetup\(next, context\)\}/);
  assert.match(source, /setValue\(next\); notifyPresenterAssetsUpdated\(\); setMessage\('人物授权已取消/);
});
