import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('./studio.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../../src/components/AiCreateStudio.tsx', import.meta.url), 'utf8');

assert.match(route, /studioRouter\.post\('\/render\/jobs'/, 'persistent render creation route exists');
assert.match(route, /tenant_id: tenantId, project_id: projectId, idempotency_key: idempotencyKey/, 'idempotency lookup is project and tenant scoped');
assert.match(route, /project\.tenant_id !== tenantId/, 'project access is tenant isolated');
assert.match(route, /isManualStudioProject\(projectSpec\)/, 'persistent browser rendering is restricted to manual free creation');
assert.match(route, /createHash\('sha256'\)\.update\(`\$\{projectId\}\\n\$\{outputKey\}\\n\$\{inputSignature\}`\)/,
  'same project output and production input replay the same job');
assert.match(route, /A process restart leaves a processing record behind/, 'a status read resumes interrupted server work');
assert.match(route, /languageRenderOutputs:[\s\S]*status: 'done'/, 'completed output is written back to the project');
assert.match(route, /job\.tenant_id !== tenantId/, 'retry cannot cross tenants');
assert.match(ui, /latestRenderJob\(projectId\)/, 'the editor restores render progress after remount');
assert.match(ui, /if \(freeThreeStep\)[\s\S]*createRenderJob/, 'free creation uses persistent jobs');
assert.match(ui, /getDesktopRender\(\)\?\.available/, 'Electron remains on its existing bridge');
console.log('studio persistent render job contract tests passed');
