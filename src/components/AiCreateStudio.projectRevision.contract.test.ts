import { readAiStudioApplicationSources } from '../../tests/fixtures/aiStudioApplicationSources.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readAiStudioApplicationSources();

assert.match(source, /const projectRevisionRef = useRef<string \| undefined>\(undefined\)/,
  'the editor keeps its server revision outside the hot-reloaded API module');
assert.match(source, /const adoptEditorProjectRevision = \(project: StudioProject\) => \{\s*studioApi\.adoptProjectRevision\(project\);\s*projectRevisionRef\.current = project\.updatedAt;\s*projectRevisionProjectIdRef\.current = project\.id/,
  'every editor adoption must synchronize both the API baseline and component revision');
assert.match(source, /if \(p\.status !== 'template'\) \{\s*adoptEditorProjectRevision\(p\)/,
  'loading a project must use the shared revision adoption helper');
assert.match(source, /targetProjectId[\s\S]{0,700}baseUpdatedAt: projectRevisionRef\.current/,
  'ordinary autosaves must send the editor revision explicitly after a Vite module refresh');
assert.equal((source.match(/studioApi\.saveProject\(/g) || []).length, 1,
  'every workbench production action must use the single versioned save wrapper');
assert.match(source, /const saveStudioProjectVersioned[\s\S]{0,600}baseUpdatedAt: projectRevisionRef\.current/,
  'the shared workbench save wrapper must survive an API-module hot refresh by using the component revision');
assert.match(source, /\.\.\.\(!input\.baseUpdatedAt && targetProjectId[\s\S]{0,260}baseUpdatedAt: projectRevisionRef\.current/,
  'a caller-provided fresh CAS revision must take precedence over the component fallback revision');
assert.match(source, /const current = await studioApi\.getProject\(id,[\s\S]{0,500}baseUpdatedAt: current\.updatedAt/,
  'title saves for managed or frozen projects must preserve the fresh revision returned by their GET');
assert.match(source, /const result = await studioApi\.requalityProject\(projectId\)[\s\S]{0,400}input\.onProject\(result\.project\)/,
  'a newly signed quality record must invoke the project revision callback');
assert.match(source, /onProject: project => \{\s*adoptEditorProjectRevision\(project\);\s*setProjects\(/,
  'the live page callback must advance both the editor revision and project list');
assert.match(source, /deliveryWorkspace\.requalityCurrentProject\(createDeliveryContext\(\)\)/,
  'the quality action must use the current page revision callback');
assert.match(source, /const project = list\.find\(item => item\.id === targetProjectId\)[\s\S]{0,180}adoptEditorProjectRevision\(project\)/,
  'publish-return hydration must advance the component revision before the next autosave');
const reloadRequiredBranch = source.slice(source.indexOf("saved.recovery === 'reload_required'"), source.indexOf("if (!saved.ok)", source.indexOf("saved.recovery === 'reload_required'")));
assert.match(reloadRequiredBranch, /showProjectSaveConflict\(project, nextSpec\)/,
  'an unmergeable conflict must retain the local snapshot and ask before reloading');
assert.doesNotMatch(reloadRequiredBranch, /applySpec\(/,
  'autosave conflict recovery must not silently discard the current editor state');
assert.match(source, /projectSaveConflictRef\.current = \{ project, localSpec: structuredClone\(localSpec\) \}[\s\S]{0,600}notification\.warning[\s\S]{0,600}reloadLatestProjectAfterConflict/,
  'the retained conflict must expose an explicit reload action while autosave remains paused');
assert.match(source, /saved\.recoveredFromConflict[\s\S]{0,300}applySpec\(project\.spec\)/,
  'a losslessly merged server response must replace the stale in-memory editor snapshot');

console.log('Studio project revision recovery contract passed');
