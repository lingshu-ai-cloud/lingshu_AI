import { authHeader } from './auth';
export type AccountPlatform = 'linkedin' | 'facebook' | 'youtube' | 'tiktok' | 'instagram';
export type CrawlContentMode = 'video' | 'image' | 'mixed';
export interface CompetitorAccount {
  id: string; platform: AccountPlatform; accountUrl: string; accountName: string;
  handle: string; avatarUrl: string; note: string; lastCrawledAt: string; lastCrawlCount: number;
  lastCrawlMode?: CrawlContentMode; crawlStatus?: 'running' | 'completed' | 'failed'; crawlError?: string; createdAt: string;
}
export async function readCompetitorAccounts(): Promise<CompetitorAccount[]> {
  const response = await fetch('/api/overseas/competitor-accounts', { headers: authHeader(), cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(result.items)) throw new Error(result.error || '对标账号读取失败，请重试');
  return result.items;
}
