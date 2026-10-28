import { authHeader } from './auth';
import { isSocialInsightReport, type SocialInsightJob } from '../../shared/socialInsightReport';

const states = new Set(['queued', 'running', 'succeeded', 'partial', 'blocked', 'failed', 'unknown', 'empty']);
export function parseSocialInsightJob(value: unknown): SocialInsightJob {
  if (!value || typeof value !== 'object') throw Error('报告任务返回格式无效，请稍后核对任务结果。');
  const job = value as SocialInsightJob;
  if (typeof job.id !== 'string' || !/^[a-f0-9]{15}$/.test(job.id) || !states.has(job.status) || typeof job.keyword !== 'string'
    || !['queued', 'collecting', 'analyzing', 'completed', 'blocked'].includes(job.stage)
    || typeof job.createdAt !== 'string' || typeof job.updatedAt !== 'string'
    || (job.report !== undefined && !isSocialInsightReport(job.report))) throw Error('报告任务返回格式无效，请稍后核对任务结果。');
  return job;
}
async function read(response: Response): Promise<SocialInsightJob> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Error(body?.error?.message || body?.message || '报告服务暂时不可用，请核对任务状态。');
  return parseSocialInsightJob(body);
}
export async function createSocialInsightReport(keyword: string, requestId: string, signal: AbortSignal): Promise<SocialInsightJob> {
  return read(await fetch('/api/overseas/strategy/social-insight-reports', {
    method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword, requestId }), signal,
  }));
}
export async function readSocialInsightReport(id: string, signal: AbortSignal): Promise<SocialInsightJob> {
  return read(await fetch(`/api/overseas/strategy/social-insight-reports/${encodeURIComponent(id)}`, { headers: authHeader(), cache: 'no-store', signal }));
}
