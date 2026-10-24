import assert from 'node:assert/strict';
import test from 'node:test';
import { discoveryFailurePresentation } from './discoveryFailurePresentation';

test('classifies discovery failures without replacing provider evidence', () => {
  assert.equal(discoveryFailurePresentation('TikTok: HTTP 401 invalid api key')?.kind, 'authentication');
  assert.equal(discoveryFailurePresentation('YouTube quota exceeded HTTP 429')?.kind, 'quota');
  assert.equal(discoveryFailurePresentation('discovery_run_scope_invalid: keyword required')?.kind, 'input');
  assert.equal(discoveryFailurePresentation('Instagram search failed SSL timeout')?.kind, 'network');
  assert.equal(discoveryFailurePresentation('执行状态：暂无结果；新增 0 条')?.kind, 'no_data');
  assert.equal(discoveryFailurePresentation('平台采集失败：provider exploded')?.kind, 'unknown');
  assert.equal(discoveryFailurePresentation('执行状态：执行成功；新增 3 条'), null);
  assert.equal(discoveryFailurePresentation('API key 已配置，执行状态：执行成功'), null);
});
