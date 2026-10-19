import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const editor = readFileSync(new URL('./WeeklyProductSelectionIntervention.tsx', import.meta.url), 'utf8');
const actions = readFileSync(new URL('./WeeklyTaskQuickActions.tsx', import.meta.url), 'utf8');

test('real task card offers explicit all-publications or mother-group scope without inferred SKU', () => {
  assert.match(actions, /weekly_production_product_selection_required/);
  assert.match(actions, /weekly-product-selection-/);
  assert.match(editor, /单一商品用于全部/);
  assert.match(editor, /按母版组逐组选择/);
  assert.match(editor, /targetPublications\.map\(publication => publication\.publicationTaskId\)/);
  assert.match(editor, /SKU 未登记/);
  assert.doesNotMatch(editor, /goal\.products\[0\]|discoveryScope\.product/);
});

test('selection UI rereads after mutation and refuses ambiguous retries', () => {
  assert.match(editor, /expectedContextHash: item\.contextHash/);
  assert.match(editor, /readWeeklyPublicationProductChoices\(scope\.programId, scope\.packageId, scope\.packageVersion\)/);
  assert.match(editor, /勿重复提交/);
  assert.match(editor, /conflictingSelection/);
  assert.match(editor, /remainingTargetCount > 0/);
  assert.match(editor, /min-h-11/);
});
