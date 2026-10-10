import fs from 'node:fs';
import path from 'node:path';
import { resolveSourceDurations } from '../lib/videoSourcePlan.js';

export function requireLocalAcceptanceUrl(baseUrl: string): void {
  const url = new URL(baseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('local_acceptance_url_required: isolated local tenants must never target a remote server');
  }
}

export async function inspectAcceptanceVideos(files: string[], requiredSeconds = 20) {
  const unique = [...new Set(files.map(file => fs.realpathSync(file)))];
  const assets = await resolveSourceDurations(unique.map(localPath => ({ id: path.basename(localPath), localPath, type: 'video' as const, duration: 0 })));
  const blockers = assets.filter(asset => asset.duration < requiredSeconds).map(asset => ({
    file: asset.localPath, availableSeconds: asset.duration, requiredSeconds,
    reason: '冻结订单可能选择任一单素材；源片必须覆盖完整订单，不能通过循环或定格补长。',
  }));
  return { passed: assets.length > 0 && blockers.length === 0, requiredSeconds, assets, blockers };
}
