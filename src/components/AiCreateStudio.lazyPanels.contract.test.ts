import { readAiStudioApplicationSources } from '../../tests/fixtures/aiStudioApplicationSources.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readAiStudioApplicationSources();
const lazySource = readFileSync(new URL('./studio/studioLazyPanels.ts', import.meta.url), 'utf8');

for (const [name, path] of [
  ['AgentTaskDemoWorkbench', '../socialContent/AgentTaskDemoWorkbench'],
  ['StudioBatchReviewDialog', './StudioBatchReviewDialog'],
  ['ShotMaterialLibraryDialog', './ShotMaterialLibraryDialog'],
] as const) {
  assert.ok(
    lazySource.includes(`const ${name} = lazy(() => import('${path}'))`),
    `${name} must remain outside the initial workbench chunk`,
  );
  assert.match(
    source,
    new RegExp(`<Suspense[\\s\\S]{0,180}<${name}`),
    `${name} must have a local loading boundary`,
  );
}

assert.match(lazySource, /const BenchmarkVideoPreview = lazy\(\(\) => import\('\.\/StudioPreviewPanels'\)/);
assert.match(lazySource, /const LeadContentPackagePreview = lazy\(\(\) => import\('\.\/StudioPreviewPanels'\)/);
assert.match(lazySource, /const StudioReviewIssueActions = lazy\(\(\) => import\('\.\/StudioReviewIssueActions'\)\)/);
assert.match(source, /<Suspense[^\n]+<BenchmarkVideoPreview/);
assert.match(source, /<Suspense[^\n]+<LeadContentPackagePreview/);
assert.match(source, /<Suspense[^\n]+<StudioReviewIssueActions/);

console.log('AiCreateStudio optional panels remain lazy-loaded');
