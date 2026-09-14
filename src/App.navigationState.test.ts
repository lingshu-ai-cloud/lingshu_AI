import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const popstate = source.slice(source.indexOf("const restorePage = (event: PopStateEvent)"), source.indexOf("const back = () =>"));
assert.match(popstate, /sessionStorage\.removeItem\('digitalEmployee\.businessDeepLink'\)/,
  'a generic history entry must clear the newer task deep-link');
assert.match(popstate, /detail:\s*\{ page: previous, restoreHistory: true \}/,
  'same-page Back must notify the coordinator even when the older entry has no task detail');
assert.match(source, /else setSmartAssetsWorkflowContext\(null\)/,
  'restoring a generic Studio entry must clear stale run/task context');
assert.doesNotMatch(source, /返回上一页（保留查看位置）/,
  'the global Back control must not promise state retention for pages that unmount');

console.log('application history task-context reset contract passed');
