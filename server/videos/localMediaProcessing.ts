import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { execFileAsync, ANALYSIS_DIR, ffmpegBin } from './runtimeConfig.js';

export async function compressPocketBasePreview(sourcePath: string): Promise<string> {
  if (!ffmpegBin) throw new Error('ffmpeg is required for PocketBase preview compression');
  fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
  const outputPath = path.join(ANALYSIS_DIR, `pb-preview-${Date.now()}-${randomUUID()}.mp4`);
  await execFileAsync(ffmpegBin, [
    '-hide_banner', '-loglevel', 'error', '-i', sourcePath,
    '-vf', "scale='if(gt(iw,ih),480,-2)':'if(gt(iw,ih),-2,480)'",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '29', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart', '-y', outputPath,
  ], { timeout: 180_000 });
  // The production PocketBase request path rejects large multipart bodies even
  // when the collection file field itself allows 100 MiB. Keep long-video
  // previews below 6 MiB so the payload remains safe after multipart overhead.
  if (fs.statSync(outputPath).size > 6 * 1024 * 1024) {
    const compactPath = path.join(ANALYSIS_DIR, `pb-preview-compact-${Date.now()}-${randomUUID()}.mp4`);
    try {
      await execFileAsync(ffmpegBin, [
        '-hide_banner', '-loglevel', 'error', '-i', sourcePath,
        '-vf', "scale='if(gt(iw,ih),160,-2)':'if(gt(iw,ih),-2,160)'",
        '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '32k', '-maxrate', '48k', '-bufsize', '96k',
        '-c:a', 'aac', '-b:a', '16k', '-ac', '1', '-movflags', '+faststart', '-y', compactPath,
      ], { timeout: 240_000 });
      fs.renameSync(compactPath, outputPath);
    } finally {
      try { if (fs.existsSync(compactPath)) fs.unlinkSync(compactPath); } catch { /* best effort */ }
    }
  }
  return outputPath;
}

export async function compressVideoBufferForPocketBase(buf: Buffer, extension: string): Promise<Buffer> {
  fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
  const sourcePath = path.join(ANALYSIS_DIR, `pb-source-${Date.now()}-${randomUUID()}.${extension.replace(/[^a-z0-9]/gi, '') || 'mp4'}`);
  fs.writeFileSync(sourcePath, buf);
  let previewPath = '';
  try { previewPath = await compressPocketBasePreview(sourcePath); return fs.readFileSync(previewPath); }
  finally { try { fs.unlinkSync(sourcePath); } catch { /* best effort */ } try { if (previewPath) fs.unlinkSync(previewPath); } catch { /* best effort */ } }
}

export function runFfmpeg(args: string[]): Promise<boolean> {
  return new Promise(resolve => {
    if (!ffmpegBin) { resolve(false); return; }
    const p = spawn(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'ignore'] });
    p.on('error', () => resolve(false));
    p.on('close', code => resolve(code === 0));
  });
}

export async function extractPoster(videoPath: string, outPath: string, atSec = 1): Promise<boolean> {
  const ok = await runFfmpeg(['-ss', String(atSec), '-i', videoPath, '-frames:v', '1', '-q:v', '3', '-y', outPath]);
  return ok && fs.existsSync(outPath);
}

export async function probeDuration(videoPath: string): Promise<number> {
  return new Promise(resolve => {
    if (!ffmpegBin) { resolve(0); return; }
    const p = spawn(ffmpegBin, ['-hide_banner', '-i', videoPath, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', chunk => { stderr += chunk.toString(); });
    p.on('error', () => resolve(0));
    p.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) { resolve(0); return; }
      resolve(Math.round(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])));
    });
  });
}
