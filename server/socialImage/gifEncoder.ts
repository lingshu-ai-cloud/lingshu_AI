import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import sharp from 'sharp';

export async function createSocialImageGif(frames: Buffer[], width: number, height: number, loopDurationMs: number): Promise<Buffer> {
  if (!frames.length || width < 1 || height < 1) throw new Error('GIF 编码缺少有效画面或画布');
  const normalized = await Promise.all(frames.map(frame => sharp(frame).rotate().resize(width, height, { fit: 'cover', position: 'attention' }).png().toBuffer()));
  const delay = Math.max(250, Math.round(loopDurationMs / normalized.length));
  if (!ffmpegStatic) throw new Error('GIF 编码器不可用');
  const gifEncoder = ffmpegStatic;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-social-gif-'));
  const output = path.join(directory, 'output.gif');
  try {
    normalized.forEach((frame, index) => fs.writeFileSync(path.join(directory, `frame-${String(index).padStart(2, '0')}.png`), frame));
    await new Promise<void>((resolve, reject) => execFile(gifEncoder, [
      '-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(1000 / delay),
      '-i', path.join(directory, 'frame-%02d.png'), '-loop', '0', output,
    ], { timeout: 60_000 }, (error: Error | null) => error ? reject(error) : resolve()));
    return fs.readFileSync(output);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
