import { readStudioApplicationSources, studioApplicationFunction, studioRouteBlock } from './fixtures/studioApplicationSources.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const server = readStudioApplicationSources();
const script = studioRouteBlock(server, "studioRouter.post('/script',");
const prompt = studioApplicationFunction(server, 'buildStudioScriptPrompt');
const ui = readFileSync(new URL('../src/components/AiCreateStudio.tsx', import.meta.url), 'utf8');
assert.match(script, /generationMode !== 'clone' && provider === 'gemini' \? 'gemini' : 'qwen'/);
assert.match(script, /untrustedPromptData\(\s*'material_observations',\s*structuredMaterials/);
assert.match(prompt, /可用素材的片段观察[\s\S]*?\$\{materialObservationEvidence\}/);
assert.match(prompt, /素材：<已有素材写准确文件名及原素材起止秒/);
assert.match(script, /const shouldBlockScript = hardValidationIssues.length > 0/);
assert.match(script, /code: 'SCRIPT_QUALITY_BLOCKED'/);
assert.match(studioApplicationFunction(server, 'automationStoryboardAssignmentIssues'),
  /storyboardAigcAssignmentIssues\([\s\S]*storyboardKbAssignmentIssuesForSpec\(/);
assert.match(ui, /segments\?\.some\(segment => usableEvidenceSegment\(segment, item.duration\)\)/);
assert.match(ui, /matchEvidenceSegment\(clip, slot\)/);
console.log('clone material evidence contract passed (offline, no model calls)');
