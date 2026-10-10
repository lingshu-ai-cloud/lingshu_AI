import assert from 'node:assert/strict';
import test from 'node:test';
import { currentStudioProjectQualityRecord, studioProjectQualityFingerprint, studioProjectQualityIssues } from './studioProjectQuality.js';

const base = {
  contentMode: 'video', creationPath: 'free_creation', script: '[0-2] hello', voiceoverMode: 'none', subtitlesOn: false,
  analysisResults: { storyboard: { slots: [{ id: 's1' }] } }, storyboardAssignments: { s1: 'material-1' },
  languageRenderOutputs: { v1: { status: 'done', path: '/tmp/final.mp4' } }, languageRenderVersions: {},
  renderAcceptance: { accepted: true, renderPath: '/tmp/final.mp4' },
};

test('quality fingerprint invalidates signed record after a meaningful edit', () => {
  const inputFingerprint = studioProjectQualityFingerprint(base);
  const record = { id: 'q1', inputFingerprint, generationProvenance: 'ai', qualityStatus: 'passed', publishable: true,
    createdAt: '2026-10-08T00:00:00Z', createdBy: 'u1', projectRevision: 'r1', renderPath: '/tmp/final.mp4',
    report: { gateVersion: 'studio-project-quality-v1', checks: [] } } as const;
  const signed = { ...base, activeProjectQualityRecordId: 'q1', projectQualityRecords: [record] };
  assert.equal(currentStudioProjectQualityRecord(signed)?.id, 'q1');
  assert.equal(currentStudioProjectQualityRecord({ ...signed, script: '[0-2] edited' }), null);
  assert.equal(currentStudioProjectQualityRecord({ ...signed, storyboardAssignments: { s1: 'material-2' } }), null);
  assert.equal(currentStudioProjectQualityRecord({ ...signed, subtitleStyle: { color: '#000' } }), null);
});

test('quality gate requires accepted current render and complete bindings', () => {
  assert.deepEqual(studioProjectQualityIssues(base), []);
  assert.match(studioProjectQualityIssues({ ...base, storyboardAssignments: {} }).join('；'), /分镜/);
  assert.match(studioProjectQualityIssues({ ...base, renderAcceptance: null }).join('；'), /验收/);
  assert.match(studioProjectQualityIssues({ ...base, renderAcceptance: { accepted: true, renderPath: '/tmp/old.mp4' } }).join('；'), /正式渲染/);
});
