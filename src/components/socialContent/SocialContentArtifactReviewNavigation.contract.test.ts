import { readAiStudioApplicationSources } from '../../../tests/fixtures/aiStudioApplicationSources.js';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const app=readFileSync(new URL('../../App.tsx',import.meta.url),'utf8');
const pageSlot=readFileSync(new URL('../../AppPageSlot.tsx',import.meta.url),'utf8');
const studio=readAiStudioApplicationSources();

test('a task-scoped studio dead end can return to the authoritative artifact review workspace',()=>{
  assert.match(studio,/打开任务验收与交付/);
  assert.match(studio,/onNavigate\?\.\('smartAssets'\)/);
  assert.match(app,/Boolean\(smartAssetsContentTaskId && !smartAssetsWorkflowContext && !smartAssetsCreateRequest\)/);
  assert.match(pageSlot,/taskOnly=\{Boolean\(smartAssetsContentTaskId && !smartAssetsCreateRequest\)\}/);
});
