import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DataStore, Record_ } from '../storage/datastore.js';
import type { ContentExecutionJob } from '../contentExecution/durableQueueRecords.js';
import type { WeeklyTaskWorkspaceRuntime } from '../../shared/contracts/weeklyTaskWorkspace.js';

const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const obj = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const status = (value: unknown): value is 'passed' | 'blocked' | 'unknown' => value === 'passed' || value === 'blocked' || value === 'unknown';
const observed = (value: unknown): value is boolean | null => value === null || typeof value === 'boolean';

/** Only expose evidence for the blocked original job and the exact cached render bytes.
 * Paths, detector messages and other checkpoint payload fields never leave the server. */
export async function weeklyVideoQualityEvidence(store: DataStore, job: ContentExecutionJob | null, roots = {
  render: path.resolve('data/content-execution-render'), quality: path.resolve('data/content-execution-quality'),
}): Promise<WeeklyTaskWorkspaceRuntime['videoQuality']> {
  if (!job || job.status !== 'blocked' || !/^user_input_required:(?:subtitle_style|video_timeline)_(?:blocked|unknown):/.test(job.lastError || '')) return null;
  const tasks = await store.list<Record_>('starter_social_content_tasks', { where: { tenant_id: job.tenantId, task_id: job.taskId }, page: 1, perPage: 2 });
  if (tasks.totalItems !== 1 || tasks.items.length !== 1 || tasks.items[0]?.tenant_id !== job.tenantId || tasks.items[0]?.task_id !== job.taskId || tasks.items[0]?.run_id !== job.runId) return null;
  const reportCheckpoint = job.checkpoints['social.video_node_quality'];
  const renderCheckpoint = job.checkpoints['social.graph_render'];
  const report = obj(reportCheckpoint?.payload), render = obj(renderCheckpoint?.payload);
  const subtitle = obj(report?.subtitleStyle), timeline = obj(report?.timeline);
  if (reportCheckpoint?.version !== '1' || renderCheckpoint?.version !== '2' || report?.schemaVersion !== 'voice-driven-video-quality.v1'
    || !hash(report.mediaSha256) || render?.sha256 !== report.mediaSha256 || !subtitle || subtitle.schemaVersion !== 'subtitle-style-sampling.v1'
    || subtitle.mediaSha256 !== report.mediaSha256 || !status(subtitle.status) || !timeline || !status(timeline.status)
    || !Array.isArray(subtitle.samples) || subtitle.samples.length > 3) return null;
  const scope = digest(JSON.stringify([job.tenantId, job.taskId, job.runId]));
  const expectedPath = path.join(roots.render, scope, `${report.mediaSha256}.mp4`);
  if (render.cachePath !== expectedPath) return null;
  try { if (digest(await readFile(expectedPath)) !== report.mediaSha256) return null; } catch { return null; }
  const samples: NonNullable<WeeklyTaskWorkspaceRuntime['videoQuality']>['samples'] = [];
  for (const raw of subtitle.samples) {
    const sample = obj(raw);
    if (!sample || !hash(sample.frameSha256) || typeof sample.atSeconds !== 'number' || !Number.isFinite(sample.atSeconds)
      || sample.atSeconds < 0 || sample.atSeconds > 30 || !observed(sample.subtitlePresent)
      || !observed(sample.font) || !observed(sample.fontSize) || !observed(sample.color) || typeof sample.framePath !== 'string') return null;
    const base = path.basename(sample.framePath);
    if (!new RegExp(`^\\d+-${sample.frameSha256}\\.png$`).test(base)
      || sample.framePath !== path.join(roots.quality, report.mediaSha256, base)) return null;
    try { if (digest(await readFile(sample.framePath)) !== sample.frameSha256) return null; } catch { return null; }
    samples.push({ frameSha256:sample.frameSha256, atSeconds: sample.atSeconds, subtitlePresent: sample.subtitlePresent,
      font: sample.font, fontSize: sample.fontSize, color: sample.color });
  }
  return { mediaSha256: report.mediaSha256, ...(hash(reportCheckpoint.inputHash)?{qualityInputHash:reportCheckpoint.inputHash}:{}), subtitleStatus: subtitle.status, timelineStatus: timeline.status, samples };
}
