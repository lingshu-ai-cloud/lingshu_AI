import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpeg from 'ffmpeg-static';
import {prepareWeeklyQualityAuditFixture} from '../runtime/weeklyContentQualityAudit.fixture.js';
import {createShootingReferencePreview} from './shootingReferencePreview.js';
import {probeReferenceMediaClock} from '../lib/referenceMediaClock.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';

test('task preview returns only a real bounded clip, verifies ownership and rejects changed bindings', async t => {
  const f = await prepareWeeklyQualityAuditFixture(); t.after(f.cleanup);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shooting-preview-')); t.after(() => fs.rm(root, {recursive:true,force:true}));
  const dir = path.join(root, 'tenants/t/reference-videos'); await fs.mkdir(dir,{recursive:true});
  const source = path.join(dir,'actual.mp4'); assert.ok(ffmpeg);
  await promisify(execFile)(ffmpeg, ['-hide_banner','-loglevel','error',
    '-f','lavfi','-i','color=red:size=96x96:rate=30:d=1.033333333',
    '-f','lavfi','-i','color=blue:size=96x96:rate=30:d=1.033333333',
    '-f','lavfi','-i','color=green:size=96x96:rate=30:d=1.033333333',
    '-f','lavfi','-i','sine=frequency=440:duration=3.1',
    '-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map','[v]','-map','3:a',
    '-c:v','libx264','-c:a','aac','-pix_fmt','yuv420p','-y',source]);
  const sha = createHash('sha256').update(await fs.readFile(source)).digest('hex');
  const analysis = {analysisMode:'exact',analysisQuality:'video_review_required',analysisRunId:'run',contentSha256:sha,
    gemini:{scriptDetails15s:[{time:'0-1.033333',visual:'red'},{time:'1.033333-2.066667',visual:'blue'},{time:'2.066667-3.1',visual:'green'}]}};
  await f.store.create('trend_videos',{id:'actual',tenantId:'t',videoFileId:'tenants/t/reference-videos/actual.mp4',aiAnalysis:JSON.stringify(analysis)});
  const payload = {sourceProjectId:'p',sourceAssemblyId:'a',sourceShotId:'stable',sourceStoryboardSlotId:'slot-2',requirements:'v1',
    referenceClip:{schemaVersion:'shooting-reference.v1',projectId:'p',shotId:'stable',storyboardSlotId:'slot-2',videoId:'actual',referenceShotId:'slot-2',startSeconds:1.033333,endSeconds:2.066667,description:'blue'}};
  await f.store.create('studio_shooting_tasks',{id:'task',tenant_id:'t',payload});
  const preview = createShootingReferencePreview(f.store,{mediaRoot:root});
  await assert.rejects(preview('foreign','task'),{code:'shooting_task_not_found'});
  await f.store.update('studio_shooting_tasks','task',{payload:{...payload,referenceClip:{...payload.referenceClip,endSeconds:2}}});
  await assert.rejects(preview('t','task'),{code:'shooting_reference_changed'});
  assert.equal(f.tables.reference_exact_shot_evidence?.length || 0,0,'stale binding does not trigger extraction');
  await f.store.update('studio_shooting_tasks','task',{payload});
  const [a,b] = await Promise.all([preview('t','task'),preview('t','task')]);
  assert.equal(a.physicalClip,true); assert.equal(a.start,0); assert.equal(a.sourceStart,1.033333); assert.equal(a.sourceEnd,2.066667);
  assert.equal(a.clipSha256,b.clipSha256); assert.equal(f.tables.reference_exact_shot_evidence!.length,1);
  const clip = path.join(root,new URL(a.url,'http://local').pathname.slice('/media/'.length));
  assert.notEqual(clip,source); assert.equal(createHash('sha256').update(await fs.readFile(clip)).digest('hex'),a.clipSha256);
  const clock = await probeReferenceMediaClock(clip); assert.ok(Math.abs(clock.duration-31/30)<.04, `AAC packet padding may extend the container, not its video frames: ${clock.duration}`);
  const {stdout} = await promisify(execFile)(ffmpeg,['-v','error','-i',clip,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:10*1024*1024});
  assert.equal(stdout.length,96*96*3*31);
  for(let i=0;i<stdout.length;i+=3) assert.ok(stdout[i]!<50 && stdout[i+1]!<50 && stdout[i+2]!>180,'every decoded pixel remains inside blue scene, including last frame');
  const row = f.tables.reference_exact_shot_evidence![0]!;
  const oldPayload = structuredClone(row.payload) as any;
  for(const detail of oldPayload.details) delete detail.materialEvidence.extractionVersion;
  await f.store.update('reference_exact_shot_evidence',row.id,{payload:oldPayload,record_hash:socialRequestHash(oldPayload)});
  const upgraded = await preview('t','task'); assert.equal(upgraded.clipSha256,a.clipSha256);
  const upgradedPayload = f.tables.reference_exact_shot_evidence![0]!.payload as any;
  assert.equal(upgradedPayload.details[1].materialEvidence.extractionVersion,'source-clock-trim-v2');
  await f.store.update('trend_videos','actual',{tenantId:'foreign'});
  await assert.rejects(preview('t','task'),{code:'shooting_reference_not_found'});
  assert.equal(f.tables.starter_usage_ledger?.length||0,0);
});
