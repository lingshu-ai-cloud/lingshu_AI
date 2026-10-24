import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCreationFinishingEvidence } from './creationFinishingEvidence';
import type { CreationSelection } from '../../shared/contracts/contentCreationDialogue';
const selection: CreationSelection = { referenceId: 'real-ref', productIds: ['p'], shotIds: ['ref:real-ref:s1'], evidenceVersion: 'a'.repeat(64), productionDraft: { projectId: 'project' } };

test('unbound planning never searches other projects or claims missing global media', async () => {
  const reply = await readCreationFinishingEvidence('tenant', { ...selection, productionDraft: {} }, '已确认口播', async () => assert.fail('unbound planning must not guess a project'));
  assert.equal(reply.binding, 'unbound'); assert.equal(reply.code, 'creation_project_unbound');
});
test('foreign or stale project media is never borrowed', async () => {
  assert.equal((await readCreationFinishingEvidence('tenant', selection, '口播', async () => null)).code, 'creation_project_unavailable');
  const reply = await readCreationFinishingEvidence('tenant', selection, '新口播', async () => ({ spec: { studioCreateRequest: { creationDialoguePlan: { selection } }, script: '旧口播', voiceoverAudios: { zh: { url: '/media/old.wav', duration: 20 } } } }));
  assert.equal(reply.binding, 'mismatch'); assert.equal(reply.audioRecords, 0);
});
test('existing Studio metadata stays unverified and exposes no playback URL or timecodes', async () => {
  const reply = await readCreationFinishingEvidence('tenant', selection, '口播', async (tenant, id) => {
    assert.equal(tenant, 'tenant'); assert.equal(id, 'project');
    return { spec: { studioCreateRequest: { creationDialoguePlan: { selection } }, voiceoverLines: '口播', voiceoverAudios: { zh: { url: '/media/audio.wav', duration: 20 } }, alignedCuesByLang: { zh: [{ start: 0, end: 1, text: '口播' }] }, languageRenderOutputs: { zh: { path: '/media/output.mp4' } } } };
  });
  assert.equal(reply.binding, 'bound'); assert.equal(reply.code, 'creation_project_metadata_only');
  assert.equal(reply.audioRecords, 1); assert.equal(reply.subtitleRecords, 1); assert.equal(reply.renderRecords, 1);
  assert.doesNotMatch(JSON.stringify(reply), /audio.wav|output.mp4|"start"|"ready"/);
});
test('project storage errors fail instead of becoming missing artifacts', async () => {
  await assert.rejects(readCreationFinishingEvidence('tenant', selection, '口播', async () => { throw new Error('storage unavailable'); }), /storage unavailable/);
});
