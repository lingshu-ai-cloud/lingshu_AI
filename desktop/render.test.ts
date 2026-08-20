import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static') as string;
const { composite } = require('./render.cjs') as {
  composite: (manifest: unknown, onProgress?: (pct: number) => void, outDir?: string) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
};

function run(args: string[]) {
  return new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stderr }));
  });
}

const root = mkdtempSync(path.join(os.tmpdir(), 'studio-render-test-'));
const sourceA = path.join(root, 'a.mp4');
const sourceB = path.join(root, 'b.mp4');
const outputDir = path.join(root, 'output');
try {
  for (const [file, color, size] of [[sourceA, 'red', '320x180'], [sourceB, 'blue', '180x320']] as const) {
    const generated = await run(['-hide_banner', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}:r=30:d=1`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', file]);
    assert.equal(generated.code, 0, generated.stderr);
  }

  const server = http.createServer((req, res) => {
    const file = req.url === '/a.mp4' ? sourceA : req.url === '/b.mp4' ? sourceB : '';
    if (!file) { res.writeHead(404).end(); return; }
    res.setHeader('content-type', 'video/mp4');
    createReadStream(file).pipe(res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const result = await composite({
      jobId: 'timeline-continuity',
      spec: { ratio: '9:16', duration: 2, platform: 'tiktok', language: 'en', bgmVol: 0, voiceVol: 0 },
      timeline: [
        { url: `http://127.0.0.1:${address.port}/a.mp4`, trimStart: 0, trimEnd: 1, speed: 1, targetDuration: 1 },
        { url: `http://127.0.0.1:${address.port}/b.mp4`, trimStart: 0, trimEnd: 1, speed: 1, targetDuration: 1 },
      ],
      subtitles: { mode: 'off', cues: [] },
      bgm: { url: null },
      voiceover: { url: null },
    }, undefined, outputDir);
    assert.equal(result.ok, true, result.error);
    assert.ok(result.outputPath && existsSync(result.outputPath));
    assert.ok(statSync(result.outputPath).size > 2_000, 'rendered MP4 should contain real video frames');
    const decoded = await run(['-hide_banner', '-v', 'error', '-i', result.outputPath!, '-f', 'null', '-']);
    assert.equal(decoded.code, 0, decoded.stderr);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('desktop render continuity test passed');
