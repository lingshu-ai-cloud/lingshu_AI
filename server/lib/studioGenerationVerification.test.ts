import assert from 'node:assert/strict';
import {
  publishableStudioGenerationFromSpec,
  verifiedStudioGenerationFromSpec,
} from './studioGenerationVerification.js';

const verifiedScript = {
  id: 'script-v1',
  script: '[0-3s]\n画面：产品细节',
  generationProvenance: 'ai',
  qualityStatus: 'passed',
  publishable: true,
};
const spec = {
  script: verifiedScript.script,
  activeModeScriptId: verifiedScript.id,
  modeScripts: [verifiedScript],
};
const claim = publishableStudioGenerationFromSpec(spec);
assert.deepEqual(claim, {
  generationKind: 'script',
  generationProvenance: 'ai',
  qualityStatus: 'passed',
  publishable: true,
  generationRecordId: 'script-v1',
});
assert.equal(verifiedStudioGenerationFromSpec(spec, claim).ok, true);

const edited = { ...spec, script: `${spec.script}\n台词：手动新增承诺` };
const stale = verifiedStudioGenerationFromSpec(edited, claim);
assert.equal(stale.ok, false, 'a manually edited timeline cannot reuse the previous quality verdict');
assert.equal(stale.ok ? '' : stale.code, 'studio_generation_record_stale');
assert.equal(publishableStudioGenerationFromSpec(edited), null);

assert.equal(verifiedStudioGenerationFromSpec(spec, {
  ...claim,
  generationProvenance: 'manual_draft',
  publishable: false,
}).ok, false);

const posterSpec = {
  posterJsonText: '{"headline":"Confirmed product"}',
  posterDraft: {
    provenance: 'ai', qualityStatus: 'passed', publishable: true, fieldsToConfirm: [],
  },
};
const posterClaim = publishableStudioGenerationFromSpec(posterSpec, 'poster');
assert.ok(posterClaim);
assert.equal(verifiedStudioGenerationFromSpec(posterSpec, posterClaim).ok, true);
assert.equal(publishableStudioGenerationFromSpec({
  ...posterSpec,
  posterDraft: { ...posterSpec.posterDraft, fieldsToConfirm: ['MOQ'] },
}, 'poster'), null);

console.log('studio generation verification tests passed');
