import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editor = readFileSync(new URL('./WeeklyCtaContactIntervention.tsx', import.meta.url), 'utf8');
const quickActions = readFileSync(new URL('./WeeklyTaskQuickActions.tsx', import.meta.url), 'utf8');
const workbench = readFileSync(new URL('./WeeklyOperatingWorkbench.tsx', import.meta.url), 'utf8');

test('one frozen weekly CTA contact editor records only the scoped contact and re-reads authority', () => {
  assert.match(editor, /expectedContextHash: item\.contextHash/);
  assert.match(editor, /expectedReceiptId: item\.receiptId/);
  assert.match(editor, /contactChannel: 'whatsapp', contactValue: value\.trim\(\)/);
  assert.match(editor, /await socialProgramApi\.readWeeklyCtaContact[\s\S]*if \(next\.status === 'recorded'\)/);
  assert.match(editor, /const productLabel = item\?\.selectedProduct\?\.name/);
  assert.match(editor, /lingshu:weekly-product-selection-updated/);
  assert.match(editor, /\[identity, openWhenMissing, selectionRevision\]/);
  assert.match(editor, /联系方式：\{item\.status === 'recorded' \? '已记录' : '待填写'\}；免费样品承诺：待提供可核验证据/);
  assert.match(editor, /setExpanded\(next\.status === 'missing' && openWhenMissing\)/);
  assert.match(editor, /<Input id="weekly-cta-contact-value"[^>]*autoFocus/);
  assert.match(editor, /const errorRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(editor, /if \(error\) errorRef\.current\?\.focus\(\)/);
  assert.match(editor, /\{error && <div ref=\{errorRef\} tabIndex=\{-1\}>/);
  assert.match(editor, /className="flex flex-wrap gap-2"/);
  assert.match(editor, /htmlFor="weekly-cta-contact-value"/);
  assert.match(editor, /cause\.status === 409/);
  assert.match(editor, /读取最新版本/);
  assert.match(editor, /cause\?\.status === 404 \? '当前任务没有可填写的冻结 CTA，请核对周包版本。'/);
  assert.doesNotMatch(editor, /发布已授权|自动继续成片|样品政策已核验/);
  assert.match(editor, /item && <section id=\{samplePolicySectionId\}/);
  for (const requirement of ['适用范围', '运费及税费', '有效期', '企业来源', '正式证据审查']) {
    assert.ok(editor.includes(requirement), `sample evidence guidance must explain ${requirement}`);
  }
});

test('task-card actions switch from contact gap to sample-evidence gap after a recorded contact', () => {
  assert.match(quickActions, /ctaContactStatus\?: 'missing' \| 'recorded' \| 'unavailable'/);
  assert.match(quickActions, /ctaContactStatus==='missing'\?'联系号码待填写；免费样品承诺也待可核验证据。':ctaContactStatus==='recorded'\?'联系方式已记录；免费样品承诺仍待可核验证据/);
  assert.match(quickActions, /ctaContactStatus!=='unavailable'/);
  assert.match(quickActions, /weekly_cta_contact_read_failed/);
  assert.match(quickActions, /action\.action === 'cta_contact' \|\| action\.action === 'sample_policy'/);
  assert.match(quickActions, /action\.action === 'sample_policy' \? `weekly-cta-sample-policy-/);
  assert.match(quickActions, /samplePolicySectionId=\{`weekly-cta-sample-policy-/);
  assert.match(quickActions, /onRecorded=\{refreshAudit\}/);
  assert.match(quickActions, /openWhenMissing=\{ctaContactStatus==='missing'\}/);
  assert.match(workbench, /selectedProductionTasks\.find\(item=>item\.schedule\.stepKind==='script'\)\?\.taskId===task\.taskId/);
});
