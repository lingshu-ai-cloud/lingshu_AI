import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { parseSentenceSemanticQuality, sampleSemanticVideoFrames } from './sentenceSemanticQuality.js';

test('semantic quality accepts traceable frame evidence', () => {
  const report = parseSentenceSemanticQuality({ version: 1,
    identity: { status: 'pass', confidence: .93, evidence: '五官轮廓与痣的位置一致', frameRefs: ['presenter', 'candidate_start', 'candidate_end'] },
    actionMotion: { status: 'pass', confidence: .9, evidence: '双手动作顺序一致', frameRefs: ['source_quarter', 'candidate_quarter', 'source_middle', 'candidate_middle'] },
    productBrandText: { status: 'unknown', confidence: .2, evidence: '源片没有清晰产品文字', frameRefs: [] }, limitations: ['静态帧不能判断口型'] }, 'qwen-test');
  assert.equal(report.identity.status, 'pass'); assert.equal(report.actionMotion.status, 'pass'); assert.equal(report.productBrandText.status, 'unknown'); assert.equal(report.model, 'qwen-test');
});

test('semantic quality rejects decisions without valid frame references', () => {
  assert.throws(() => parseSentenceSemanticQuality({ version: 1,
    identity: { status: 'pass', confidence: .9, evidence: 'same', frameRefs: [] },
    actionMotion: { status: 'pass', confidence: .9, evidence: 'same', frameRefs: ['source_start', 'candidate_start'] },
    productBrandText: { status: 'fail', confidence: .8, evidence: 'changed', frameRefs: ['invented'] } }, 'qwen-test'), /帧引用/);
});

test('semantic quality requires cross-frame and source/candidate evidence for factual decisions', () => {
  assert.throws(() => parseSentenceSemanticQuality({ version: 1,
    identity: { status: 'pass', confidence: .9, evidence: 'same', frameRefs: ['presenter', 'candidate_start'] },
    actionMotion: { status: 'pass', confidence: .9, evidence: 'same', frameRefs: ['source_start', 'source_end', 'candidate_start', 'candidate_end'] },
    productBrandText: { status: 'pass', confidence: .9, evidence: 'same', frameRefs: ['source_middle', 'candidate_middle'] } }, 'qwen-test'), /跨帧候选证据/);
});

test('semantic quality samples traceable start middle and end frames from real video', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lingshu-semantic-sample-'));const video=path.join(dir,'video.mp4');
  try{execFileSync(String(ffmpegStatic),['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x240:rate=24','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-y',video]);const frames=await sampleSemanticVideoFrames(video,'candidate');assert.deepEqual(frames.map(frame=>frame.label),['candidate_start','candidate_quarter','candidate_middle','candidate_three_quarters','candidate_end']);assert.ok(frames.every(frame=>frame.bytes.length>100));}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
