import { readAiStudioApplicationSources } from '../../tests/fixtures/aiStudioApplicationSources.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchEvidenceSegment, usableEvidenceSegment } from './segmentEvidence';
import type { MaterialSegment } from './studioApi';

const segment: MaterialSegment = { id: 'gel-action', start: 4, end: 8, duration: 4,
  subject: ['面部', '工具'], action: '工具在面部涂抹凝胶', productVisible: true, productClarity: 'high',
  shot: '近景', angle: '', composition: '', camera: '固定', environment: '', quality: 80,
  ocrText: '', hasPerson: true, hasLogo: false, logoText: [], recommendedFunctions: [],
  authenticity: '', confidence: 0.9, needsReview: false };
const slot = { start: 8, end: 10.125, detail: '画面：工具在面部涂抹凝胶。\n台词：介绍护理过程。' };
const clip = { type: 'video', duration: 28, segments: [segment] };
assert.equal(matchEvidenceSegment(clip, slot)?.trimStart, 4);
assert.equal(matchEvidenceSegment(clip, slot)?.trimEnd, 6.125);
assert.equal(matchEvidenceSegment({ ...clip, segments: [] }, slot), null);
assert.equal(matchEvidenceSegment(clip, { ...slot, detail: '画面：滴管透明液体滴到手部。' }), null);
assert.equal(matchEvidenceSegment(clip, { ...slot, end: 15 }), null);
assert.equal(matchEvidenceSegment({ ...clip, segments: [{ ...segment, needsReview: true }] }, slot), null);
assert.ok(matchEvidenceSegment({ ...clip, segments: [{ ...segment, needsReview: true, manualConfirmed: true }] }, slot));
assert.equal(usableEvidenceSegment({ ...segment, end: 40 }, 28), false);
assert.equal(usableEvidenceSegment({ ...segment, start: -1 }, 28), false);
assert.equal(usableEvidenceSegment({ ...segment, confidence: 0.1 }, 28), false);
assert.equal(matchEvidenceSegment({ ...clip, type: 'image' }, slot), null);
assert.equal(matchEvidenceSegment({ ...clip, segments: [{ ...segment, action: '没有工具在面部涂抹凝胶' }] }, slot), null);
const ui = readAiStudioApplicationSources();
assert.match(ui, /if \(productionFor\(slot\)\.locked \|\| storyboardSourcePlans\[slot.id\]\?\.mode === 'ai' \|\| storyboardSourcePlans\[slot.id\]\?\.mode === 'hybrid'\) return false;/, 'automatic matching must skip locked and explicit AI source plans');
assert.match(ui, /materialInfos: buildMaterialInfosForScript/);
assert.match(ui, /editForSlot\(activeWorkbenchClip, slot\)\.trimStart\.toFixed\(1\)[^\n]+plan.matchReason \|\| activeMaterialAssessment\?\.reason/, 'workbench must display the actual selected segment interval and match evidence');
assert.match(ui, /segmentId: evidenceTrim.segmentId/, 'matched segment identity must accompany saved trim range');
console.log('segment evidence tests passed');
