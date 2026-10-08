import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('./studio.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../../src/components/AiCreateStudio.tsx', import.meta.url), 'utf8');

assert.match(route, /studioRouter\.use\(requireAuth\)/, 'Studio routes require authentication');
assert.match(route, /project\.tenant_id !== tenantId/, 'handoff lookup is tenant scoped');
assert.match(route, /isManualStudioProject\(spec\)/, 'only manual free-creation projects can use the handoff');
assert.match(route, /studioProjectRenderPaths\(spec\)\.includes\(renderPath\)/, 'the submitted render must belong to the project');
assert.match(route, /req\.body\?\.reviewed !== true/, 'a user review is required');
assert.match(route, /savedAcceptance\.accepted !== true \|\| String\(savedAcceptance\.renderPath \|\| ''\) !== renderPath/,
  'the server must verify that the same render was durably accepted instead of trusting the client flag');
assert.match(ui, /提交团队审核/);
assert.match(ui, /加入发布计划/);
assert.match(ui, /disabled=!\{?currentRenderReviewed|disabled=\{!currentRenderReviewed/, 'handoff actions stay disabled until review');

console.log('studio manual handoff route contract tests passed');
