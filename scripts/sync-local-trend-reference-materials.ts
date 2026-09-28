import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildDownloadedReferenceMaterial } from '../server/lib/downloadedReferenceMaterial.js';
import { readLocalMaterials, saveLocalMaterials } from '../server/lib/materialLibrary.js';

const dataRoot = path.resolve('data');
const mediaRoot = path.join(dataRoot, 'media');
const trendFile = path.join(dataRoot, 'local-store', 'trend_videos.json');
const trends = JSON.parse(fs.readFileSync(trendFile, 'utf8')) as Array<Record<string, unknown>>;
const materials = readLocalMaterials();
let added = 0;

for (const trend of trends) {
  const id = String(trend.id || '');
  const tenantId = String(trend.tenantId || '');
  const storedFile = String(trend.videoFileId || '');
  const file = storedFile.startsWith('crawlers/') ? `object-storage/${storedFile}` : storedFile;
  if (!/^trend_videos_[a-z0-9]+$/.test(id) || !/^local_tenant_[a-z0-9_]+$/.test(tenantId)
    || !(file.startsWith(`tenants/${tenantId}/reference-videos/`)
      || file.startsWith(`object-storage/crawlers/tenants/${tenantId}/trend-videos/${id}/video.mp4`))) continue;
  const absolute = path.resolve(mediaRoot, file);
  if (!absolute.startsWith(`${mediaRoot}${path.sep}`) || !fs.existsSync(absolute)) continue;
  const materialId = `local-reference-${id}`;
  if (materials.some(item => item.id === materialId || item.file === file)) continue;
  const bytes = fs.readFileSync(absolute);
  const duration = Number(trend.duration || 0);
  const platform = String(trend.platform || 'tiktok').toLowerCase();
  if (!['youtube', 'facebook', 'instagram', 'tiktok'].includes(platform)) continue;
  materials.push(buildDownloadedReferenceMaterial({
    id: materialId, tenantId, name: String(trend.title || id), platform: platform as 'youtube' | 'facebook' | 'instagram' | 'tiktok',
    sourceUrl: String(trend.sourceUrl || `local://${id}`), duration: Number.isFinite(duration) ? duration : 0,
    size: `${(bytes.length / 1024 / 1024).toFixed(1)} MB`, file,
    contentSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    createdAt: String(trend.createdAt || new Date().toISOString()),
  }));
  added += 1;
}

if (added) saveLocalMaterials(materials);
console.log(`已同步 ${added} 条本地参考视频到当前账号的“我的素材”`);
