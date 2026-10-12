import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('./PresenterFirstFrameReviewPanel.tsx',import.meta.url),'utf8');
const workspace=fs.readFileSync(new URL('./SocialContentWorkspace.tsx',import.meta.url),'utf8');
test('workspace exposes explicit per-group presenter first-frame confirmation',()=>{assert.match(workspace,/PresenterFirstFrameReviewPanel/);assert.match(source,/listPresenterFirstFrameReviews\(taskId,runId\)/);assert.match(source,/confirmPresenterFirstFrameReview\(taskId,runId,item\.groupId,item\.expectedRecordHash/);assert.match(source,/item\.status==='confirmed'/);assert.doesNotMatch(source,/confirmAll|autoConfirm|confirmed:\s*true/);});
