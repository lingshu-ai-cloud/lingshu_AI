import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const studio = readFileSync(new URL('../routes/studio.ts', import.meta.url), 'utf8');

assert.doesNotMatch(studio, /loadMaterials\(\)\.filter\(item => item\.url !== material\.url\)/, 'empty R2 URL must never be material identity');
assert.ok((studio.match(/upsertMaterialIndex\(loadMaterials\(\), material\)/g) || []).length >= 3, 'generated material writes must use safe identity upsert');
assert.match(studio, /digitalHumanWorkerClaimGate\.run/);
assert.match(studio, /digitalHumanPullLeaseRecoveryTimer/);
assert.match(studio, /recoverExpiredDigitalHumanWorkerJobs/);
const finalizeStart = studio.indexOf('async function finalizeDigitalHumanFile(');
const firstFence = studio.indexOf('job = assertDigitalHumanFinalizationCurrent(job.id, transfer);', finalizeStart);
const validation = studio.indexOf('const serverValidation = await validateDigitalHumanMediaFile', finalizeStart);
const secondFence = studio.indexOf('job = assertDigitalHumanFinalizationCurrent(job.id, transfer);', firstFence + 1);
assert.ok(finalizeStart >= 0 && firstFence > finalizeStart && validation > firstFence, 'finalize must fence before long validation');
assert.ok(secondFence > validation, 'finalize must re-read and fence after long validation');
assert.match(studio, /beforeCommit: \(\) => \{ job = assertDigitalHumanFinalizationCurrent/);
assert.match(studio, /\['completed', 'review', 'cancelled'\]\.includes\(completed\.status\)/, 'review output must also release its temporary upload');
assert.match(studio, /fileMatchesSha256\(destination, expectedSha256, sizeBytes\)/, 'existing upload destination must be rehashed');
assert.match(studio, /freshVoiceoverUrl = signAssetUrl\(voiceoverPath, job\.tenantId\)/, 'queued audio must receive a fresh claim-time signature');
assert.match(studio, /requireP1RenderTreatmentAudit:\s*p1LocalWorkerResult/,
  'P1本地Worker成片必须由服务端强制验真渲染回执');
assert.match(studio, /expectedBaseRenderFingerprint:\s*expectedP1BaseRenderFingerprint/,
  '服务端必须用任务表演计划重建基础渲染指纹');

console.log('digital human server reliability contract tests passed');
