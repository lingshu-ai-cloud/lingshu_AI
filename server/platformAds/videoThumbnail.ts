import { spawn } from 'node:child_process';
import { ffmpegBin } from '../videos/runtimeConfig.js';

const cache = new Map<string, Promise<Buffer>>();

async function extractFirstFrame(bytes: Buffer): Promise<Buffer> {
  if (!ffmpegBin) throw new Error('ffmpeg unavailable');
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-frames:v', '1', '-vf', "scale='if(gt(iw,ih),320,-2)':'if(gt(iw,ih),-2,320)'", '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks: Buffer[] = []; let size = 0;
    child.stdout.on('data', chunk => { size += chunk.length; if (size <= 2 * 1024 * 1024) chunks.push(Buffer.from(chunk)); else child.kill(); });
    child.on('error', reject);
    child.on('close', code => code === 0 && size > 0 && size <= 2 * 1024 * 1024 ? resolve(Buffer.concat(chunks)) : reject(new Error('thumbnail unavailable')));
    child.stdin.on('error', () => undefined);
    child.stdin.end(bytes);
  });
}

/** Deduplicate first-frame work for immutable source identities during a server lifetime. */
export function cachedVideoThumbnail(key: string, load: () => Promise<Buffer>): Promise<Buffer> {
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = load().then(extractFirstFrame).catch(error => { cache.delete(key); throw error; });
  cache.set(key, pending);
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  return pending;
}
