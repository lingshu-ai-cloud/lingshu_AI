import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(new URL('./InspirationDashboard.tsx', import.meta.url), 'utf8')
  + readFileSync(new URL('./inspiration/InspirationMaterialGallery.tsx', import.meta.url), 'utf8');
const detail = readFileSync(new URL('./inspiration/InspirationMaterialDetailDrawer.tsx', import.meta.url), 'utf8');
const usagePanel = readFileSync(new URL('./inspiration/MaterialUsageHistory.tsx', import.meta.url), 'utf8');
const productGroup = readFileSync(new URL('./material-library/ProductMaterialGroup.tsx', import.meta.url), 'utf8');

test('material wall keeps usage markers compact while detail owns complete history', () => {
  assert.match(dashboard, /import \{ MaterialUsageMark \} from '.\/MaterialUsageHistory'/);
  assert.match(dashboard, /<InspirationMaterialDetailDrawer[\s\S]{0,180}material=\{detailMaterial\}/);
  assert.match(usagePanel, /已使用 \{summary\.totalUses\} 次/);
  assert.match(usagePanel, /前三秒 \{summary\.hookUses\} 次/);
  assert.match(usagePanel, /使用次数与历史表现/);
  assert.match(usagePanel, /只统计已产出成品的真实使用/);
  assert.match(usagePanel, /等待平台数据回传/);
  assert.match(detail, /<MaterialUsagePanel material=\{material\}/);
});

test('materials nested in product drawers retain independent usage marks', () => {
  assert.match(productGroup, /已用 \{material\.usageSummary\?\.totalUses\} 次/);
  assert.match(productGroup, /前三秒 \{material\.usageSummary\?\.hookUses\} 次/);
});
