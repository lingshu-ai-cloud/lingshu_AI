import assert from 'node:assert/strict';
import test from 'node:test';
import {writeFile} from 'node:fs/promises';
import {acceptWeeklyUnknownVideoQuality} from './weeklyVideoQualityAcceptance.js';
import {VIDEO_QUALITY_ACCEPTANCE_STAGE} from '../starter198/socialVideoQualityAcceptance.js';
import {weeklyVideoQualityFixture as fixture} from './weeklyVideoQuality.fixture.js';


test('accepts only the same current media and replays without creating another job or replacing its receipt',async t=>{
  const f=await fixture(t),result=await f.accept();assert.equal(result.status,'queued');assert.equal(result.mediaSha256,f.input.expectedMediaSha256);
  const first=structuredClone((f.job().checkpoints as Record<string,unknown>)[VIDEO_QUALITY_ACCEPTANCE_STAGE]);
  const replay=await acceptWeeklyUnknownVideoQuality(f.store,{...f.scope,actorUserId:'other-owner'},f.input);
  assert.equal(replay.acceptanceHash,result.acceptanceHash);assert.equal(replay.status,'queued');
  assert.deepEqual((f.job().checkpoints as Record<string,unknown>)[VIDEO_QUALITY_ACCEPTANCE_STAGE],first);assert.equal(f.tables.get('content_execution_jobs')!.length,1);
});

test('rejects stale run, job, media and cross-tenant acceptance without writing a decision',async t=>{
  const f=await fixture(t);
  for(const changed of [{expectedRunId:'stale'},{expectedJobId:'stale'},{expectedMediaSha256:'c'.repeat(64)}])await assert.rejects(acceptWeeklyUnknownVideoQuality(f.store,f.scope,{...f.input,...changed}),/变化/);
  await assert.rejects(acceptWeeklyUnknownVideoQuality(f.store,{...f.scope,tenantId:'foreign'},f.input),/不存在/);
  assert.equal((f.job().checkpoints as Record<string,unknown>)[VIDEO_QUALITY_ACCEPTANCE_STAGE],undefined);assert.equal(f.job().status,'blocked');
});

test('explicit subtitle or timeline failure cannot be accepted as unknown',async t=>{
  const f=await fixture(t),checkpoints=f.job().checkpoints as Record<string,{payload:{timeline:{status:string};subtitleStyle:{status:string}}}>;
  for(const field of ['timeline','subtitleStyle'] as const){checkpoints['social.video_node_quality']!.payload[field].status='blocked';await assert.rejects(f.accept(),/明确失败/);checkpoints['social.video_node_quality']!.payload[field].status=field==='timeline'?'unknown':'passed';}
  assert.equal((f.job().checkpoints as Record<string,unknown>)[VIDEO_QUALITY_ACCEPTANCE_STAGE],undefined);
});

test('tampered render bytes cannot authorize the original unknown result',async t=>{
  const f=await fixture(t);await writeFile(f.cachePath,'different-video');await assert.rejects(f.accept(),/变化/);assert.equal(f.job().status,'blocked');
});

test('a paused job without current blocked quality evidence cannot be resumed through acceptance',async t=>{
  const f=await fixture(t);f.job().status='paused';await assert.rejects(f.accept(),/变化/);
  assert.equal(f.job().status,'paused');assert.equal((f.job().checkpoints as Record<string,unknown>)[VIDEO_QUALITY_ACCEPTANCE_STAGE],undefined);
});

test('a receipt saved before a failed resume can recover the original blocked job on replay',async t=>{
  const f=await fixture(t);f.failNextResume();await assert.rejects(f.accept(),/content_execution_job_control_failed/);assert.equal(f.job().status,'blocked');
  const receipt=structuredClone((f.job().checkpoints as Record<string,unknown>)[VIDEO_QUALITY_ACCEPTANCE_STAGE]);assert.ok(receipt);
  const replay=await f.accept();assert.equal(replay.status,'queued');assert.equal(f.job().status,'queued');
  assert.deepEqual((f.job().checkpoints as Record<string,unknown>)[VIDEO_QUALITY_ACCEPTANCE_STAGE],receipt);assert.equal(f.tables.get('content_execution_jobs')!.length,1);
});

test('subtitle failure requires an explicit current-film confirmation and never authorizes a failed timeline',async t=>{
  const f=await fixture(t),quality=(f.job().checkpoints as any)['social.video_node_quality'].payload;
  quality.subtitleStyle.status='blocked';
  await assert.rejects(f.accept(),/字幕样式失败需要用户明确确认/);
  quality.timeline.status='blocked';
  await assert.rejects(acceptWeeklyUnknownVideoQuality(f.store,f.scope,{...f.input,confirmSubtitleStyle:true}),/音画同步明确失败/);
  quality.timeline.status='unknown';
  const result=await acceptWeeklyUnknownVideoQuality(f.store,f.scope,{...f.input,confirmSubtitleStyle:true});
  assert.equal(result.status,'queued');
  const receipt=(f.job().checkpoints as any)[VIDEO_QUALITY_ACCEPTANCE_STAGE].payload;
  assert.equal(receipt.decision,'accept_subtitle_style');assert.equal(receipt.mediaSha256,f.input.expectedMediaSha256);
  assert.equal(f.tables.get('content_execution_jobs')!.length,1);
});
