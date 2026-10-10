import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachReviewShotMaterials, initialReferenceShotReview, updateReferenceShotReview } from '../lib/referenceShotReview.js';

const record = {id:'video-1',aiAnalysis:JSON.stringify({analysisRunId:'run-1',durationSeconds:60,gemini:{scriptDetails15s:[
  {time:'0-0.10',visual:'flash',purpose:'transition'},
  {time:'0.10-60',visual:'factory',purpose:'trust'},
]}})};

test('six chapters are hypotheses and a flash may be discarded without losing timeline coverage', () => {
  const initial = initialReferenceShotReview(record);
  assert.equal(initial.sections.length, 6);
  assert.equal(initial.sections.every(s => !s.confirmed), true);
  const updated = updateReferenceShotReview(record, {
    expectedVersion:initial.version,
    sections:initial.sections.map(s => ({...s,confirmed:true})),
    shots:[
      {...initial.shots[0],reviewStatus:'discarded'},
      {...initial.shots[1],shotId:'review-a',end:30,reviewStatus:'confirmed',labels:['factory'],hookAction:'人物快速靠近镜头并在镜头前完成敲门手势，然后退回站立。',hookMotionConfirmed:true,hookScript:{camera:'手持近景',visual:'工厂车间，人物靠近镜头',subject:'灰西装女性',music:'无',voiceover:'无',soundEffects:'待原片复核',spokenWords:'无',subjectAction:'快速靠近并敲门'},hookScriptConfirmed:true},
      {...initial.shots[1],shotId:'review-b',start:30,reviewStatus:'confirmed',labels:['product']},
    ],
    selectedHookShotId:'review-a',
  });
  assert.equal(updated.shots.length,3);
  assert.equal(updated.shots[0]?.reviewStatus,'discarded');
  assert.equal(updated.reviewComplete,true);
  assert.equal(updated.productionExecutionAllowed,false);
  assert.throws(() => updateReferenceShotReview(record,{expectedVersion:'old',sections:updated.sections,shots:updated.shots}),/review_version_conflict/);
});

test('short opening action is eligible while incomplete eight-field script blocks review completion', () => {
  const initial = initialReferenceShotReview(record);
  const short = updateReferenceShotReview(record, { expectedVersion:initial.version,
    sections:initial.sections.map(s => ({...s,confirmed:true})),
    shots:[{...initial.shots[0],reviewStatus:'discarded'},
      {...initial.shots[1],start:.1,end:.8,reviewStatus:'confirmed',labels:['真人动作'],hookAction:'人物快速靠近镜头并做敲门手势，随后退回。',hookMotionConfirmed:true},
      {...initial.shots[1],shotId:'review-rest',start:.8,reviewStatus:'confirmed',labels:['口播']}],
    selectedHookShotId:'shot-2',
  });
  assert.equal(short.selectedHookShotId,'shot-2');
  assert.equal(short.reviewComplete,false);
});

test('reject a gap between confirmed shots and an untraceable source shot', () => {
  const initial = initialReferenceShotReview(record);
  const sections = initial.sections;
  assert.throws(() => updateReferenceShotReview(record,{expectedVersion:initial.version,sections,shots:[
    {...initial.shots[0],reviewStatus:'discarded'},
    {...initial.shots[1],start:1},
  ]}),/shots_must_cover_video/);
  assert.throws(() => updateReferenceShotReview(record,{expectedVersion:initial.version,sections,shots:[
    initial.shots[0],{...initial.shots[1],sourceShotIds:['invented']},
  ]}),/invalid_review_shot_range/);
});

test('review material references are server issued and invalidated by range edits', () => {
  const initial = initialReferenceShotReview(record);
  const persisted = {...record,referenceShotReview:JSON.stringify(initial)};
  const materialized = attachReviewShotMaterials(persisted,'shot-2',initial.version);
  assert.equal(materialized.shots[1]?.evidenceRefs.length,2);
  const changed = updateReferenceShotReview({...record,referenceShotReview:JSON.stringify(materialized)}, {
    expectedVersion:materialized.version,sections:materialized.sections,
    shots:materialized.shots.map(s => s.shotId === 'shot-2' ? {...s,start:.2,evidenceRefs:['forged']} : {...s,end:.2}),
  });
  assert.deepEqual(changed.shots[1]?.evidenceRefs,[]);
});
