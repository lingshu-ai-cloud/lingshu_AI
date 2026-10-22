import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AiCreateStudio.tsx', import.meta.url), 'utf8');

for (const [name, path] of [
  ['AgentTaskDemoWorkbench', './socialContent/AgentTaskDemoWorkbench'],
  ['StudioBatchReviewDialog', './studio/StudioBatchReviewDialog'],
  ['ShotMaterialLibraryDialog', './studio/ShotMaterialLibraryDialog'],
] as const) {
  assert.ok(
    source.includes(`const ${name} = lazy(() => import('${path}'))`),
    `${name} must remain outside the initial workbench chunk`,
  );
  assert.match(
    source,
    new RegExp(`<Suspense[\\s\\S]{0,180}<${name}`),
    `${name} must have a local loading boundary`,
  );
}

assert.match(source, /const BenchmarkVideoPreview = lazy\(\(\) => import\('\.\/studio\/StudioPreviewPanels'\)/);
assert.match(source, /const LeadContentPackagePreview = lazy\(\(\) => import\('\.\/studio\/StudioPreviewPanels'\)/);
assert.match(source, /const StudioReviewIssueActions = lazy\(\(\) => import\('\.\/studio\/StudioReviewIssueActions'\)\)/);
assert.match(source, /<Suspense[^\n]+<BenchmarkVideoPreview/);
assert.match(source, /<Suspense[^\n]+<LeadContentPackagePreview/);
assert.match(source, /<Suspense[^\n]+<StudioReviewIssueActions/);

console.log('AiCreateStudio optional panels remain lazy-loaded');
