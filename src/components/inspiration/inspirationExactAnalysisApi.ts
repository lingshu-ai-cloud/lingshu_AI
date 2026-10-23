import { authHeader } from '../../lib/auth';
import type { TrendVideo } from '../../lib/inspirationTypes';
import type { CrawlerRecord } from './inspirationVideoProjection';

export function parseExactAnalysisResponse(raw: string, status: number): { error?: string; status?: string; reused?: boolean; id?: string } {
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; status?: unknown; reused?: unknown; id?: unknown };
    return {
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
      status: typeof parsed.status === 'string' ? parsed.status : undefined,
      reused: typeof parsed.reused === 'boolean' ? parsed.reused : undefined,
      id: typeof parsed.id === 'string' ? parsed.id : undefined,
    };
  } catch {
    return { error: `全片精确分析接口返回异常（HTTP ${status}）` };
  }
}

export async function submitExactAnalysis(video: TrendVideo, force = false) {
  const materialId = video.id.startsWith('material-') ? video.id.slice('material-'.length) : '';
  const response = await fetch(video.recordId
    ? `/api/overseas/videos/${video.recordId}/reanalyze`
    : '/api/overseas/videos/material-exact-analysis', {
    method: video.recordId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(video.recordId
      ? { analysisMode: 'exact', ...(force ? { force: true } : {}) }
      : { materialId, title: video.title, platform: video.platform, duration: video.duration }),
  });
  const data = parseExactAnalysisResponse(await response.text(), response.status);
  if (!response.ok) throw new Error(data.error || '全片精确分析提交失败');
  return data;
}

export async function readExactAnalysisRecord(recordId: string): Promise<CrawlerRecord | null> {
  const response = await fetch(`/api/overseas/videos/${recordId}`, { headers: authHeader() });
  return response.ok ? await response.json() as CrawlerRecord : null;
}

export async function pauseExactAnalysis(recordId: string): Promise<void> {
  const response = await fetch(`/api/overseas/videos/${recordId}/analysis-pause`, {
    method: 'POST',
    headers: authHeader(),
  });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(data.error || '停止分析失败');
}
