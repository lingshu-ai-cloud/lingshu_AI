import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { buildDigitalHumanFinalQualityReport } from './digitalHumanWorkerFinalQuality.js';
import { AsyncSerialGate } from './asyncSerialGate.js';

const validationGate = new AsyncSerialGate();

export type ValidationRunner = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

const run: ValidationRunner = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { timeout: 600_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
    // Validators use 2 for a completed measurement that failed its threshold.
    const measuredFailure = Number(error?.code) === 2 && args.some(arg => /validate-(digital-human|syncnet)\.py$/.test(arg));
    if (error && !measuredFailure) reject(new Error(`质量检测程序执行失败：${path.basename(file)}`));
    else resolve({ stdout: String(stdout), stderr: String(stderr) });
  });
});

/** Measure the downloaded bytes ourselves; HeyGen does not return Worker metrics. */
async function measureHeygenOutput(
  file: string,
  mode: 'fast' | 'quality',
  options: { runner?: ValidationRunner; python?: string; syncnetDir?: string; ffmpeg?: string; ffprobe?: string } = {},
) {
  const python = options.python || process.env.HEYGEN_VALIDATOR_PYTHON;
  const syncnetDir = options.syncnetDir || process.env.DIGITAL_HUMAN_SYNCNET_DIR;
  if (!python || !syncnetDir) return {
    passed: false, validatorVersion: 'heygen-server-quality-v1',
    notes: ['云端成片质检运行环境未配置：HEYGEN_VALIDATOR_PYTHON / DIGITAL_HUMAN_SYNCNET_DIR'],
  };
  const execute = options.runner || run;
  const ffmpeg = options.ffmpeg || String(ffmpegStatic || 'ffmpeg');
  const ffprobe = options.ffprobe || process.env.DIGITAL_HUMAN_FFPROBE_PATH || 'ffprobe';
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-heygen-quality-'));
  try {
    const audio = path.join(temp, 'audio.wav');
    await execute(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:a:0', '-vn', '-ar', '16000', '-ac', '1', audio]);
    const probe = await execute(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', file]);
    const visual = await execute(python, [path.resolve('scripts/validate-digital-human.py'), '--video', file, '--audio', audio, '--enforce']);
    const sync = await execute(python, [path.resolve('scripts/validate-syncnet.py'), '--video', file, '--work-dir', path.join(temp, 'syncnet'), '--syncnet-dir', syncnetDir, '--min-confidence', mode === 'quality' ? '7' : '4', '--max-offset', mode === 'quality' ? '1' : '2', '--batch-size', '4']);
    const freeze = await execute(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-vf', 'freezedetect=n=-50dB:d=1', '-an', '-f', 'null', '-']);
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    const report = buildDigitalHumanFinalQualityReport({
      probe: JSON.parse(probe.stdout), visual: JSON.parse(visual.stdout), syncnet: JSON.parse(sync.stdout),
      freezeLog: freeze.stderr, freezeValidated: true, outputSha256: hash.digest('hex'),
      minLipSyncScore: mode === 'quality' ? 7 : 4,
    });
    // Avoid identifying a cloud measurement as a local P1 rendering receipt.
    return { ...report, validatorVersion: 'heygen-server-quality-v1' };
  } catch {
    return { passed: false, validatorVersion: 'heygen-server-quality-v1', notes: ['云端成片质检未能完成；检查服务端 Python、MediaPipe、SyncNet 权重及 FFmpeg 配置。'] };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

export function validateHeygenOutput(...args: Parameters<typeof measureHeygenOutput>) {
  // Keep CPU inference from overlapping when multiple tenant jobs complete together.
  return validationGate.run(() => measureHeygenOutput(...args));
}
