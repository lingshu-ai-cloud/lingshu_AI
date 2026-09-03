import assert from 'node:assert/strict';
import {
  RENDER_AI_DISCLOSURE_LABEL,
  RENDER_AI_DISCLOSURE_PIPELINE_VERSION,
  buildRenderAiDisclosure,
  isDigitalHumanGeneratedTimelineItem,
} from './renderAiDisclosure';

assert.equal(isDigitalHumanGeneratedTimelineItem({ sourceType: 'ai-seedance' }), false);
assert.equal(isDigitalHumanGeneratedTimelineItem({ assetRole: 'generated_clip', folder: 'upload' }), true);
assert.equal(isDigitalHumanGeneratedTimelineItem({ sourceType: 'digital-human' }), true);
assert.equal(isDigitalHumanGeneratedTimelineItem({ digitalHumanGenerated: true }), true);
assert.equal(isDigitalHumanGeneratedTimelineItem({ folder: 'presenter', assetRole: 'generated_clip' }), true);

assert.equal(buildRenderAiDisclosure('ordinary', [{ sourceType: 'ai-seedance' }]), undefined);
assert.deepEqual(buildRenderAiDisclosure('job-123', [{ sourceType: 'digital-human' }]), {
  schemaVersion: RENDER_AI_DISCLOSURE_PIPELINE_VERSION,
  required: true,
  label: RENDER_AI_DISCLOSURE_LABEL,
  containsDigitalHuman: true,
  contentId: 'lingshu-render:job-123',
  provider: 'lingshu-digital-human',
});

console.log('render AI disclosure tests passed');
