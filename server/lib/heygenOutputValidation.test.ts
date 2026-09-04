import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateHeygenOutput, type ValidationRunner } from './heygenOutputValidation.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heygen-validation-test-'));
const file = path.join(dir, 'fixture.mp4');
fs.writeFileSync(file, 'fixture bytes');
let syncPassed = true;
let calls = 0;
const runner: ValidationRunner = async (_program, args) => {
  calls++;
  let data: unknown = {};
  if (args.includes('-show_entries')) data = { format: {duration: 10}, streams: [{codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920}, {codec_type: 'audio', codec_name: 'aac'}] };
  if (args.some(arg => arg.endsWith('validate-digital-human.py'))) data = { passed: true, duration_seconds: 10, face_detection_rate: 1, mouth_jump_p95: 0.02, mouth_openness_std: 0.03, mouth_sharpness_median: 40 };
  if (args.some(arg => arg.endsWith('validate-syncnet.py'))) {
    assert.equal(args[args.indexOf('--max-offset') + 1], '1');
    assert.equal(args[args.indexOf('--min-confidence') + 1], '7');
    data = {passed: syncPassed, syncnet_confidence: syncPassed ? 8 : 2, av_offset_frames: 0, failures: syncPassed ? [] : ['sync failed']};
  }
  return {stdout: JSON.stringify(data), stderr: ''};
};
try {
  const options = {runner, python: '/test/python', syncnetDir: '/test/syncnet'};
  const good = await validateHeygenOutput(file, 'quality', options);
  assert.equal(good.passed, true);
  assert.equal('outputSha256' in good && good.outputSha256, createHash('sha256').update('fixture bytes').digest('hex'));
  assert.equal(calls, 5);
  assert.equal(good.validatorVersion, 'heygen-server-quality-v1');
  syncPassed = false;
  assert.equal((await validateHeygenOutput(file, 'quality', options)).passed, false);
  assert.equal((await validateHeygenOutput(file, 'quality', {...options, runner: async () => { throw new Error('runtime missing'); }})).passed, false);
  const source = fs.readFileSync(new URL('../routes/studio.ts', import.meta.url), 'utf8');
  assert.match(source, /job\.provider === 'heygen'\) \{\s*providerQuality = await validateHeygenOutput\(sourcePath, job.mode\)/);
  console.log('HeyGen downloaded-byte validation and failure handling passed');
} finally { fs.rmSync(dir, {recursive: true, force: true}); }
