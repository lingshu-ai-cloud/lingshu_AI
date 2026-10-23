import fs from 'fs';
import path from 'path';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { signAssetUrl } from '../lib/assetAccess.js';
import { ffmpegBin } from './runtimeConfig.js';

export const require = createRequire(import.meta.url);

export const { composite } = require('../../desktop/render.cjs') as {
  composite: (manifest: unknown, onProgress?: (pct: number) => void, outDir?: string) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
};

export function publishingRenderDir(tenantId: string): string {
  const tenantFolder = String(tenantId || 'local').replace(/[^\w.-]+/g, '-');
  return path.resolve(process.cwd(), 'data', 'publishing-uploads', tenantFolder);
}

export function publishingRenderPreviewUrl(tenantId: string, outputPath: string): string {
  const route = `/api/overseas/studio/local-renders/${encodeURIComponent(path.basename(outputPath))}`;
  return signAssetUrl(route, tenantId, 24 * 60 * 60 * 1000);
}

export function execFileAsync(file: string, args: string[], timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout }, (err, stdout) => (err ? reject(err) : resolve(String(stdout || ''))));
  });
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
