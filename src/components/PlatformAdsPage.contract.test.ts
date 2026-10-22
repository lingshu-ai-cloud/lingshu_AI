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
  assert.match(source, /page === 'adsPlans' \? '计划创编' : page === 'adsCreatives' \? '素材管理' : '投放数据'/);
  assert.match(source, /<Drawer title="AI 投手"/);
  assert.match(source, /if \(page !== 'adsManaged'\) return;[\s\S]*setManagedOpen\(true\);[\s\S]*onNavigate\('adsPlans'\)/);
  assert.doesNotMatch(source, /aria-label="投放总览视图"/);
});

test('material first-level page uses the real library rather than simulated performance or a placeholder', () => {
  assert.match(source, /MetaPlanAuditPanel taskId=\{selectedDraft.id\}/);
  assert.match(source, /initialTaskId=\{selectedDraft\?\.id\}/);
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
  assert.match(library, /\/creative-library\?page=/);
  assert.match(library, /\/creative-library\/\$\{id\}\/report/);
  assert.match(library, /value == null \? '—'/);
  assert.match(library, /URL\.revokeObjectURL/);
  assert.doesNotMatch(library, /campaignId\}\/insights|spend \|\| 0|token=/);
});
