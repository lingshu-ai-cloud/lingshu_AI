import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVideoAnalysis } from './gemini.js';
import { initialReferenceShotReview } from '../lib/referenceShotReview.js';

test('actual provider narration survives normalization into hook candidate without certifying review', () => {
  const analysis = normalizeVideoAnalysis({ scriptDetails15s: [{ time:'0-1s', visual:'Presenter shows product', dialogue:'On-screen statement', voiceover:'  Off-screen narrator  ' }] });
  assert.equal(analysis.scriptDetails15s?.[0]?.voiceover,'Off-screen narrator');
  const twice = normalizeVideoAnalysis(analysis);
  const review = initialReferenceShotReview({id:'reference',aiAnalysis:{analysisRunId:'actual-run',gemini:twice}});
  assert.equal(review.shots[0]?.hookScript?.voiceover,'Off-screen narrator');
  assert.equal(review.shots[0]?.hookScript?.spokenWords,'On-screen statement');
  assert.equal(review.shots[0]?.hookScriptConfirmed,false);
  assert.equal(review.reviewComplete,false);
});

test('missing and non-string narration remain unknown rather than speech or none', () => {
  for (const voiceover of [undefined,null,0,false,{},[]]) {
    const raw = JSON.parse(JSON.stringify({scriptDetails15s:[{time:'0-1s',visual:'Product',dialogue:'Visible speech',voiceover}]}));
    const analysis=normalizeVideoAnalysis(raw);
    assert.equal(analysis.scriptDetails15s?.[0]?.voiceover,'');
    const review=initialReferenceShotReview({id:'reference',aiAnalysis:{analysisRunId:'actual-run',gemini:analysis}});
    assert.equal(review.shots[0]?.hookScript?.voiceover,'');
    assert.equal(review.reviewComplete,false);
  }
});
