import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import ffmpegStatic from 'ffmpeg-static';
import type { DataStore } from '../storage/datastore.js';
import { createProductionRouter } from '../routes/production.js';
import { checkAvatarMedia } from './avatarMediaCheck.js';
import { readLocalMaterials, saveLocalMaterials } from './materialLibrary.js';
import { tenantAssetDir, tenantAssetRelativePath } from './assetAccess.js';
import { materialAssetObjectKey } from '../storage/materialAssets.js';
import { objectStorageEnabled, r2Upload } from '../storage/r2.js';

const MEDIA_ROOT = path.resolve(process.cwd(), 'data/media');
const TTS_ROOT = path.resolve(process.cwd(), 'data/tts');

function execFileAsync(file: string, args: string[], timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => execFile(file, args, { timeout }, error => error ? reject(error) : resolve()));
}

function humanSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function tenantTtsFile(url: string, tenantId: string): Buffer | null {
  if (!url.startsWith('/tts/') && !url.includes('/private-assets/tts/')) return null;
  const file = path.join(tenantAssetDir(TTS_ROOT, tenantId), path.basename(new URL(url, 'http://local').pathname));
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

export function createStudioAvatarProductionRouter(store: DataStore) {
  return createProductionRouter(store, async (url, duration, job, input, tenantId) => {
    const id = `avatar-${job.id.replace(/[^A-Za-z0-9-]/g, '')}`;
    const materials = readLocalMaterials();
    const existing = materials.find(item => item.id === id && item.tenantId === tenantId);
    if (existing?.avatarMediaCheck?.version === 1 && (!input.transparent || existing.avatarMediaCheck.alphaVerified)) return existing.id;
    const remote = new URL(url);
    if (remote.protocol !== 'https:' || remote.username || remote.password || remote.port || !/(^|\.)heygen\.(ai|com)$/i.test(remote.hostname)) throw new Error('供应商输出不在已核验的HeyGen素材域名中，已阻止自动下载');
    const response = await fetch(remote, { redirect: 'error', signal: AbortSignal.timeout(90000) });
    if (!response.ok || !response.body) throw new Error('数字人视频下载失败');
    const maxBytes = 110 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body.cancel(); throw new Error('数字人素材超过110MB'); }
    const reader = response.body.getReader(); const chunks: Buffer[] = []; let size = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > maxBytes) { await reader.cancel(); throw new Error('数字人素材超过110MB'); }
      chunks.push(Buffer.from(part.value));
    }
    if (!size) throw new Error('数字人视频为空');
    const file = `${id}-${randomUUID()}.${input.transparent ? 'webm' : 'mp4'}`;
    const relativeFile = tenantAssetRelativePath(tenantId, file);
    const objectKey = objectStorageEnabled() ? materialAssetObjectKey(tenantId, file) : undefined;
    const bytes = Buffer.concat(chunks);
    const checkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-avatar-check-'));
    let checked;
    try {
      const checkFile = path.join(checkDir, file);
      fs.writeFileSync(checkFile, bytes, { mode: 0o600 });
      checked = await checkAvatarMedia(checkFile, { ratio: input.ratio, duration, transparent: input.transparent });
    } finally { fs.rmSync(checkDir, { recursive: true, force: true }); }
    if (objectKey) await r2Upload({ key: objectKey, body: bytes, contentType: input.transparent ? 'video/webm' : 'video/mp4' });
    else { fs.mkdirSync(tenantAssetDir(MEDIA_ROOT, tenantId), { recursive: true }); fs.writeFileSync(path.join(MEDIA_ROOT, relativeFile), bytes); }
    const material = {
      id, name: `数字人口播 · ${input.title}`, folder: 'presenter', type: 'video', duration: checked.duration,
      width: checked.width, height: checked.height, aspectRatio: checked.width / checked.height, avatarMediaCheck: checked,
      size: humanSize(size), file: relativeFile, url: objectKey ? '' : `/media/${relativeFile}`, objectKey,
      scope: 'own', tenantId, usage: 'editable', sourceType: 'heygen', createdAt: new Date().toISOString(),
    };
    saveLocalMaterials([...materials.filter(item => !(item.id === id && item.tenantId === tenantId)), material]);
    return id;
  }, { prepareAudio: async (ref, tenantId) => {
    const media = tenantTtsFile(ref.url, tenantId);
    if (!media || !ffmpegStatic) throw new Error('统一旁白不在当前企业可用本地音频中，请重新生成或上传旁白');
    const tenantRoot = tenantAssetDir(TTS_ROOT, tenantId); fs.mkdirSync(tenantRoot, { recursive: true });
    const dir = fs.mkdtempSync(path.join(tenantRoot, 'avatar-audio-'));
    const input = path.join(dir, 'input'); const output = path.join(dir, 'shot.wav');
    try {
      fs.writeFileSync(input, media, { mode: 0o600 });
      await execFileAsync(String(ffmpegStatic), ['-hide_banner', '-loglevel', 'error', '-i', input, '-ss', String(ref.start), '-t', String(ref.duration), '-vn', '-ac', '1', '-ar', '16000', output], 30000);
      return fs.readFileSync(output);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } });
}
