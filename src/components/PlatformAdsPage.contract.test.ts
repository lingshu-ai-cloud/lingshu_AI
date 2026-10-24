import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./PlatformAdsPage.tsx', import.meta.url), 'utf8');

test('account entry and campaign import cannot retain a stale return-to-create state', () => {
  assert.match(source, /onClick=\{\(\) => \{ setReturnToCreate\(false\); setDialog\("accounts"\); \}\}/);
  assert.match(source, /onTaskImported=\{task => \{ setReturnToCreate\(false\);/);
});

test('creation labels capability without changing persisted goal values or removing draft planning', () => {
  assert.match(source, /PLATFORM_AD_GOALS\.map\(goal => <option key=\{goal\} value=\{goal\}>/);
  assert.match(source, /getAdPlanCapability\(\{ \.\.\.form, goal \}\)\.supportsCreate/);
  assert.match(source, /仅草稿规划/);
  assert.match(source, /formCapability\.reason/);
  assert.match(source, /保存草稿/);
  assert.doesNotMatch(source, /disabled=\{[^}]*!formCapability\.supportsCreate/);
});

test('the advertising unit exposes three workspaces and keeps AI management in a drawer', () => {
  assert.match(source, /<Tabs[^>]*aria-label="投放管理功能区"/);
  const layout = readFileSync(new URL('./Layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /const creatorSurface = [^;]*PLATFORM_ADS_PAGE_IDS\.includes\(page\)/, '广告子工作区必须沿用主页面的外观外壳');
  for (const page of ['adsPlans', 'adsOverview', 'adsCreatives']) {
    assert.ok(source.includes(`key: '${page}'`), `${page} must remain directly reachable in the advertising unit`);
  }
  assert.match(source, /page === 'adsPlans' \? '计划创编' : page === 'adsCreatives' \? '素材管理' : '投放数据'/);
  assert.match(source, /<Drawer title="AI 投手"/);
  assert.match(source, /if \(page !== 'adsManaged'\) return;[\s\S]*setManagedOpen\(true\);[\s\S]*onNavigate\('adsPlans'\)/);
  assert.doesNotMatch(source, /aria-label="投放总览视图"/);
});

test('material first-level page uses the real library rather than simulated performance or a placeholder', () => {
  assert.match(source, /MetaPlanAuditPanel taskId=\{selectedDraft.id\}/);
  assert.match(source, /initialTaskId=\{planNavigation\.taskId \|\| selectedDraft\?\.id\}/);
  const controls = readFileSync(new URL('./PlatformAdsOperations.tsx', import.meta.url), 'utf8');
  assert.match(controls, /creationBlocked/);
  assert.match(controls, /requestId: request.current.id/);
  assert.match(controls, /MetaPageSelect connectionId/);
  assert.match(source, /isCreativePage && \([\s\S]*<AdCreativeLibrary onOpenTask=/);
  assert.doesNotMatch(source, /mockCreativePerformance|广告素材及效果接口尚未接入/);
  const library = readFileSync(new URL('./AdCreativeLibrary.tsx', import.meta.url), 'utf8');
  assert.match(library, /LsMasonryGallery/);
  assert.match(library, /LsProgressiveMedia/);
  assert.match(library, /LsMediaStateFrame/);
  assert.match(library, /\/creative-library\?/);
  assert.match(library, /\/creative-library\/\$\{id\}\/report/);
  assert.match(library, /value == null \? '—'/);
  assert.match(library, /URL\.revokeObjectURL/);
  assert.doesNotMatch(library, /campaignId\}\/insights|spend \|\| 0|token=/);
});
test('history and advertising share a source lifecycle component without guessing ROI or CRM enquiries', () => {
  const lifecycle = readFileSync(new URL('./AdSourceLifecycle.tsx', import.meta.url), 'utf8');
  const catalog = readFileSync(new URL('./AdSourceCatalog.tsx', import.meta.url), 'utf8');
  const material = readFileSync(new URL('./AdCreativeLibrary.tsx', import.meta.url), 'utf8');
  const history = readFileSync(new URL('./socialContent/CreationMaterialHistory.tsx', import.meta.url), 'utf8');
  const home = readFileSync(new URL('./socialContent/SocialContentHistoryHome.tsx', import.meta.url), 'utf8');
  for (const text of [material, history, home]) assert.match(text, /AdSourceLifecycle/);
  assert.match(material, /AdSourceCatalog/); assert.match(catalog, /new URLSearchParams\(\{ origin/);
  assert.match(catalog, /creative-history-sources/); assert.match(catalog, /sourceTenantName/);
  assert.match(catalog, /sourceId: selected.sourceId/); assert.match(catalog, /\$\{dataset\}:\$\{page\}/);
  assert.match(lifecycle, /snapshot\?\.query === query/); assert.match(lifecycle, /非 ROI/);
  assert.match(lifecycle, /不是 0/); assert.match(lifecycle, /窗口未返回/);
  assert.match(lifecycle, /onHeaderCell/); assert.match(lifecycle, /whiteSpace: 'normal'/);
  assert.match(readFileSync(new URL('./adCreativeLibrary.css', import.meta.url), 'utf8'), /grid-template-columns: minmax\(0, 1fr\)/);
  assert.doesNotMatch(lifecycle, /\.purchaseValue\s*\/|crmInquiries\s*\|\|\s*0/);
});
test('creative workbench separates enterprise sources, recoverable covers and missing performance', () => {
  const library = readFileSync(new URL('./AdCreativeLibrary.tsx', import.meta.url), 'utf8');
  const catalog = readFileSync(new URL('./AdSourceCatalog.tsx', import.meta.url), 'utf8');
  const lifecycle = readFileSync(new URL('./AdSourceLifecycle.tsx', import.meta.url), 'utf8');
  assert.match(library, /label: '投放素材'.*label: '创作素材'/);
  assert.match(library, /setPreview\(null\); setError\(''\); setLoaded\(false\)/);
  assert.match(library, /Cover key=\{binding\?\.id \|\| item.key\}/);
  assert.match(library, /preview && !error/);
  assert.doesNotMatch(library, /defaultActiveKey=\{\['sources'\]\}/);
  assert.match(catalog, /snapshot\?\.key === key/);
  assert.match(catalog, /企业分别展示，不合并统计/);
  assert.match(catalog, /useState\('all'\)/);
  assert.match(catalog, /visible\.map\(source/);
  assert.match(catalog, /AdHistoryMedia key=/);
  assert.match(lifecycle, /原始文件缺失/);
  assert.match(lifecycle, /等待平台数据回传/);
  assert.match(lifecycle, /来源、版本与统计口径/);
  const historyMedia = readFileSync(new URL('./AdHistoryMedia.tsx', import.meta.url), 'utf8');
  assert.match(historyMedia, /data\.fileEvidence\.every\(f => f.state === 'verified'\)/);
  assert.match(historyMedia, /URL\.revokeObjectURL/);
  assert.match(historyMedia, /原始文件缺失/);
  assert.match(historyMedia, /平台暂无数据/);
  assert.match(historyMedia, /未关联广告（本系统）/);
  assert.doesNotMatch(historyMedia, /spend \|\| 0|token=|thumbnailUrl/);
});
test('plan material picking uses the same catalog, locks selection until verified and retains draft identity', () => {
  const picker = readFileSync(new URL('./AdMaterialPicker.tsx', import.meta.url), 'utf8');
  const media = readFileSync(new URL('./AdHistoryMedia.tsx', import.meta.url), 'utf8');
  const binding = readFileSync(new URL('./AdCreativePanel.tsx', import.meta.url), 'utf8');
  assert.match(picker, /<AdSourceCatalog/);
  assert.match(source, /configuration: \{ \.\.\.current.configuration, materialSource \}/);
  assert.match(media, /disabled=\{!!blockedReason \|\| !selection\}/);
  assert.match(media, /未开放跨企业投放复用/);
  assert.match(binding, /expectedSha256: selected.sha256/);
  assert.match(binding, /task.configuration.materialSource/);
  assert.match(source, /open: dialog !== null && !materialPickerOpen/);
  assert.match(source, /e.key === "Escape" && !materialPickerOpen && e.currentTarget.contains/);
  assert.doesNotMatch(binding, /<option.*sha256/);
  assert.match(media, /内部内容：/); assert.match(media, /Meta 广告：/); assert.match(media, /使用范围：/);
  assert.match(media, /mediaOnly && !source.sourceId/);
  assert.match(media, /choice.sha256 !== source.sha256/);
  assert.match(binding, /creative.taskVersion !== task.version/);
  const library = readFileSync(new URL('./AdCreativeLibrary.tsx', import.meta.url), 'utf8');
  assert.match(library, /!binding.platformVideoId/); assert.match(library, /refresh=\{refresh\} mediaOnly/);
  const selectionService = readFileSync(new URL('../../server/platformAds/creativeSelection.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(selectionService, /artifact.status !== 'approved'/);
});
test('reused videos share their availability label but never inherit another plan performance', () => {
  const library = readFileSync(new URL('./AdCreativeLibrary.tsx', import.meta.url), 'utf8');
  const binding = readFileSync(new URL('./AdCreativePanel.tsx', import.meta.url), 'utf8');
  const data = readFileSync(new URL('./AdPerformanceOverview.tsx', import.meta.url), 'utf8');
  assert.match(library, /adCreativeAvailabilityLabel\(binding\)/);
  assert.match(binding, /adCreativeAvailabilityLabel\(creative\)/);
  assert.ok(library.indexOf('if (search &&') < library.indexOf('const key = groupKey(item)'));
  assert.match(data, /已复用 Meta 视频，尚未创建广告/);
  assert.match(data, /不继承原计划的广告回执、审核状态或效果数据/);
});
