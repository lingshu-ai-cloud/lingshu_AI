import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const pageSlot = fs.readFileSync(new URL('./AppPageSlot.tsx', import.meta.url), 'utf8');
const popstate = source.slice(source.indexOf("const restorePage = (event: PopStateEvent)"), source.indexOf("const back = () =>"));
assert.match(popstate, /sessionStorage\.removeItem\('digitalEmployee\.businessDeepLink'\)/,
  'a generic history entry must clear the newer task deep-link');
assert.match(popstate, /detail:\s*\{ page: previous, restoreHistory: true \}/,
  'same-page Back must notify the coordinator even when the older entry has no task detail');
assert.match(source, /else setSmartAssetsWorkflowContext\(null\)/,
  'restoring a generic Studio entry must clear stale run/task context');
assert.doesNotMatch(source, /返回上一页（保留查看位置）/,
  'the global Back control must not promise state retention for pages that unmount');
assert.match(source, /if \(nextPage === 'enterprise'\) setEnterpriseProductsDeepLink\(normalizeEnterpriseProductsDeepLink\(detail\)\)/,
  'enterprise product navigation must consume its deep-link context');
assert.match(source, /<AppPageSlot[^>]*enterpriseProductsDeepLink/s,
  'the app must pass enterprise product context to its page slot');
assert.match(pageSlot, /<EnterprisePage productsDeepLink=\{enterpriseProductsDeepLink\}/,
  'the enterprise page must receive the selected product and material context');
assert.match(source, /!detail\.contentCreationRequest\.continueProjectId[\s\S]{0,500}localStorage\.removeItem\('ow_studio_open_project'\)[\s\S]{0,300}searchParams\.delete\('project'\)/,
  'a fresh direct-studio request must clear stale project state before opening production');

console.log('application history task-context reset contract passed');
