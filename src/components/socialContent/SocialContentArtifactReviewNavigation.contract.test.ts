import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const app=readFileSync(new URL('../../App.tsx',import.meta.url),'utf8');
const studio=readFileSync(new URL('../AiCreateStudio.tsx',import.meta.url),'utf8');

test('a task-scoped studio dead end can return to the authoritative artifact review workspace',()=>{
  assert.match(studio,/打开任务验收与交付/);
  assert.match(studio,/directStudio:\s*false/);
  assert.match(studio,/socialContentTaskId, socialContentPage: 'smartAssets'/);
  assert.match(app,/Boolean\(smartAssetsContentTaskId && !smartAssetsWorkflowContext && !smartAssetsCreateRequest\)/);
  assert.match(app,/taskOnly=\{Boolean\(smartAssetsContentTaskId && !smartAssetsCreateRequest\)\}/);
});
