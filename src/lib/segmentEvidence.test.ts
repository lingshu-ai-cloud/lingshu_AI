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
const ui = readFileSync(new URL('../components/AiCreateStudio.tsx', import.meta.url), 'utf8');
assert.match(ui, /productionFor\(slot\)\.locked \|\| storyboardAssignments\[slot.id\] \|\| \['avatar', 'shoot', 'ai'\]/);
assert.match(ui, /materialInfos: buildMaterialInfosForScript/);
assert.match(ui, /片段依据：/);
console.log('segment evidence tests passed');
