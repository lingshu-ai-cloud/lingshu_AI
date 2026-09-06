import assert from 'node:assert/strict';
import fs from 'node:fs';
import { presenterApprovalForProject, presenterApprovalMatches, presenterApprovalResumesQuality } from './presenterApprovalRecovery.js';
const binding = { tenantId: 'isolated-tenant', projectId: 'isolated-project', jobId: 'isolated-job', outputMaterialId: 'output-v1', voiceoverUrl: '/api/overseas/studio/private-assets/tts/en.wav', spokenText: 'Look at the visible components.', language: 'en' };
const approved = { id: binding.jobId, tenantId: binding.tenantId, projectId: binding.projectId, provider: 'heygen', status: 'completed', completedAt: '2026-09-06T10:00:00Z', qualityReport: { passed: true }, outputMaterialId: binding.outputMaterialId, voiceoverUrl: binding.voiceoverUrl, scriptSnapshot: binding.spokenText, language: binding.language };
const blocked = { stage: 'blocked', resumeStage: 'quality', retryPolicy: 'input_required', heygenApproved: false, heygenJobId: binding.jobId, heygenOutputMaterialId: binding.outputMaterialId, spokenText: binding.spokenText };
const spec = { lang: binding.language, voiceoverUrl: binding.voiceoverUrl };
assert.equal(presenterApprovalMatches(binding, [{ ...approved, status: 'review', completedAt: '', qualityReport: { passed: false } }]), false);
assert.equal(presenterApprovalForProject(binding.tenantId, binding.projectId, spec, blocked, [approved]), true, 'durable approval supersedes stale false snapshot');
assert.equal(presenterApprovalResumesQuality(blocked, true), true, 'approval can reopen an input_required quality block');
assert.equal(presenterApprovalResumesQuality(blocked, false), false);
assert.equal(presenterApprovalResumesQuality({ ...blocked, heygenApproved: true }, true), false, 'other unresolved quality failures do not loop after one recheck');
assert.equal(presenterApprovalResumesQuality({ ...blocked, resumeStage: 'render' }, true), false, 'approval never triggers rerender or external generation');
assert.equal(presenterApprovalResumesQuality({ ...blocked, stage: 'completed' }, true), false);
for (const patch of [
  { tenantId: 'another-tenant' }, { projectId: 'another-project' }, { id: 'replacement-job' },
  { outputMaterialId: 'replacement-output' }, { voiceoverUrl: '/tts/es.wav' }, { scriptSnapshot: 'Changed narration' },
  { language: 'es' }, { provider: 'other' }, { status: 'cancelled' }, { status: 'failed' },
  { completedAt: '' }, { qualityReport: { passed: false } },
]) assert.equal(presenterApprovalMatches(binding, [{ ...approved, ...patch }]), false, JSON.stringify(patch));
assert.equal(presenterApprovalMatches({ ...binding, jobId: '' }, [approved]), false);
assert.equal(presenterApprovalForProject(binding.tenantId, binding.projectId, spec, { ...blocked, heygenApproved: true }, []), false, 'snapshot true cannot forge or preserve missing durable approval');
const source = fs.readFileSync(new URL('./contentProduction.ts', import.meta.url), 'utf8');
assert.match(source, /if \(usesDigitalPresenter\(brief\)\) automation\.heygenApproved = presenterApprovalForProject/);
assert.match(source, /!approvalChanged && !contentProjectRetryable/);
assert.match(source, /retryable: contentProjectRetryable\(projectAutomation\(project\)\) \|\| presenterApprovalResumesQuality/);
console.log('Presenter approval recovery passed (in-memory records only; no provider or live writes).');
