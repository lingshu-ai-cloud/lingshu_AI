import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../InspirationDashboard.tsx', import.meta.url), 'utf8');
const dialogs = readFileSync(new URL('./InspirationMaterialDialogs.tsx', import.meta.url), 'utf8');

test('material dialogs keep actions and upload ownership in the page', () => {
  assert.match(page, /<MaterialUploadDialog[\s\S]*?onChooseFile=\{\(\) => \{ setMaterialUploadDialogOpen\(false\); uploadInputRef\.current\?\.click\(\); \}\}/);
  assert.match(page, /<MaterialManageDialog[\s\S]*?onConfirm=\{\(\) => void \(manageTarget\?\.action === 'delete' \? deleteManagedItem\(\) : saveManagedItem\(\)\)\}/);
  assert.doesNotMatch(dialogs, /fetch\(|studioApi|authHeader/, 'display dialogs must not mutate tenant records');
});

test('scene uploads and delete confirmations retain explicit guards', () => {
  assert.match(dialogs, /disabled: Boolean\(props\.productSceneKind && !props\.productId\)/);
  assert.match(dialogs, /keyboard=\{!props\.busy\} closable=\{!props\.busy\}/);
  assert.match(dialogs, /danger: target\.action === 'delete'/);
  assert.match(dialogs, /target\.kind === 'material'/);
});
