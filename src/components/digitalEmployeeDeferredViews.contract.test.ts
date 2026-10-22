import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('src/components/DigitalEmployeePage.tsx', 'utf8');
const views = fs.readFileSync('src/components/digitalEmployeeDeferredViews.tsx', 'utf8');

assert.match(page, /from '\.\/digitalEmployeeDeferredViews'/);
assert.doesNotMatch(page, /^import .* from ['"]\.\/SmartBusinessDashboard['"]/m);
assert.doesNotMatch(page, /^import .* from ['"]\.\/WeeklyReviewPanel['"]/m);
assert.match(views, /lazy\(\(\) => import\('\.\/SmartBusinessDashboard'\)\)/);
assert.match(views, /lazy\(\(\) => import\('\.\/WeeklyReviewPanel'\)\)/);
assert.match(page, /<Suspense fallback=\{deferredWorkspaceFallback\}><WeeklyCommandCenter/);
assert.match(page, /<Suspense fallback=\{deferredWorkspaceFallback\}><WeeklyReviewPanel/);

console.log('Digital employee deferred view boundary contract passed');
