import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { inspectReplicationMediaEvidence } from './replicationMediaEvidenceWorker.js';

assert.ok(ffmpeg);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'replication-media-worker-'));
try {
  const reference = path.join(root, 'reference.mp4');
  const output = path.join(root, 'output.mp4');
  const make = (file: string, color: string, frequency: number) => execFileSync(String(ffmpeg), [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=${color}:s=160x240:d=1:r=24`,
    '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=1`, '-shortest', '-c:v', 'libx264', '-c:a', 'aac', '-y', file,
  ]);
  make(reference, 'red', 440);
  make(output, 'blue', 880);
  const result = await inspectReplicationMediaEvidence({
    referenceVideoPath: reference,
    outputVideoPath: output,
    factors: [{ factorId: 'motion-1', sceneId: 'scene-1', category: 'interaction', policy: 'bounded' }],
  });
  assert.equal(result.reuseRiskEvidence.find(item => item.kind === 'consecutive_frame_similarity')?.status, 'available');
  assert.equal(result.reuseRiskEvidence.find(item => item.kind === 'audio_fingerprint_similarity')?.status, 'available');
  assert.equal(result.factorEvidence[0]?.factorId, 'motion-1');
  assert.ok(result.limitations.some(item => item.includes('身份')));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('replication media evidence worker tests passed');
