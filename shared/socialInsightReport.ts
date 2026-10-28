/** A public-sample snapshot, never a platform-wide ranking or growth measurement. */
export interface SocialInsightVideo {
  caption?: string; searchQueries?: string[];
  id: string; url: string; thumbnailUrl: string | null; title: string;
  publishedAt: string; views: number | null; likes: number | null;
  comments: number | null; shares: number | null;
}
export interface SocialInsightChart {
  id: string; title: string; type: 'bar'; unit: string;
  data: Array<{ label: string; value: number | null; videoId?: string }>;
}
export interface SocialInsightMerchantContext {
  businessModel: 'b2b'; industry: string | null; productCategories: string[];
}
export interface SocialInsightMaterials {
  status: 'completed';
  assignments: Array<{ videoId: string; category: 'b2b' | 'b2c'; confidence: 'high' | 'low';
    reason: string; merchantHelp: string; contentAngle: string; evidenceNeeded: string[] }>;
  groups: Array<{ category: 'b2b' | 'b2c'; summary: string; recommendations: string[]; rankedVideoIds: string[] }>;
}
export interface SocialInsightReport {
  version: 1; keyword: string; platform: 'tiktok';
  period: { from: string; to: string; timeZone: 'Asia/Shanghai' };
  collectedAt: string; sampleCount: number; videos: SocialInsightVideo[];
  merchantContext?: SocialInsightMerchantContext; materials?: SocialInsightMaterials;
  charts: SocialInsightChart[]; analysisMarkdown: string; limitations: string[];
}
export interface SocialInsightJob {
  id: string; keyword: string;
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'blocked' | 'failed' | 'unknown' | 'empty';
  stage: 'queued' | 'collecting' | 'analyzing' | 'completed' | 'blocked';
  createdAt: string; updatedAt: string;
  error?: { code: string; message: string };
  report?: SocialInsightReport;
}
export function isSocialInsightReport(value: unknown): value is SocialInsightReport {
  if (!value || typeof value !== 'object') return false;
  try {
  const report = value as SocialInsightReport;
  const metric = (v: unknown) => v === null || typeof v === 'number' && Number.isFinite(v) && v >= 0;
  return report.version === 1 && report.platform === 'tiktok' && typeof report.keyword === 'string'
    && !!report.period && typeof report.period.from === 'string' && typeof report.period.to === 'string'
    && report.period.timeZone === 'Asia/Shanghai' && typeof report.collectedAt === 'string'
    && Number.isFinite(Date.parse(report.collectedAt)) && Number.isFinite(Date.parse(report.period.from)) && Number.isFinite(Date.parse(report.period.to))
    && Number.isInteger(report.sampleCount) && report.sampleCount >= 0 && report.sampleCount <= 30 && Array.isArray(report.videos) && report.sampleCount === report.videos.length
    && report.videos.every(v => v !== null && typeof v === 'object' && typeof v.id === 'string' && (v.searchQueries === undefined || Array.isArray(v.searchQueries) && v.searchQueries.every(q => typeof q === 'string')) && typeof v.url === 'string' && typeof v.title === 'string'
      && (v.caption === undefined || typeof v.caption === 'string' && v.caption.length <= 2000)
      && typeof v.publishedAt === 'string' && (v.thumbnailUrl === null || typeof v.thumbnailUrl === 'string')
      && [v.views, v.likes, v.comments, v.shares].every(metric))
    && Array.isArray(report.charts) && report.charts.length <= 8 && report.charts.every(c => c !== null && typeof c === 'object' && typeof c.id === 'string' && typeof c.title === 'string'
      && c.type === 'bar' && typeof c.unit === 'string' && Array.isArray(c.data)
      && c.data.length <= 30 && c.data.every(d => d !== null && typeof d === 'object' && typeof d.label === 'string' && metric(d.value)))
    && (report.merchantContext === undefined || report.merchantContext !== null && report.merchantContext.businessModel === 'b2b' && (report.merchantContext.industry === null || typeof report.merchantContext.industry === 'string') && Array.isArray(report.merchantContext.productCategories) && report.merchantContext.productCategories.every(v => typeof v === 'string'))
    && (report.materials === undefined || validMaterials(report.materials, report.videos))
    && typeof report.analysisMarkdown === 'string' && Array.isArray(report.limitations)
    && report.limitations.every(v => typeof v === 'string');
  } catch { return false; }
}

function validMaterials(materials: SocialInsightMaterials, videos: SocialInsightVideo[]): boolean {
  if (!materials || materials.status !== 'completed' || !Array.isArray(materials.assignments) || !Array.isArray(materials.groups)) return false;
  const ids = new Set(videos.map(v => v.id)), seen = new Set<string>();
  if (materials.assignments.length !== ids.size || materials.groups.length !== 2) return false;
  for (const a of materials.assignments) {
    if (!a || !ids.has(a.videoId) || seen.has(a.videoId) || !['b2b','b2c'].includes(a.category) || !['high','low'].includes(a.confidence)
      || ![a.reason,a.merchantHelp,a.contentAngle].every(v => typeof v === 'string' && v.length > 0) || !Array.isArray(a.evidenceNeeded) || !a.evidenceNeeded.every(v => typeof v === 'string')) return false;
    seen.add(a.videoId);
  }
  return new Set(materials.groups.map(g => g?.category)).size === 2 && materials.groups.every(g => g && ['b2b','b2c'].includes(g.category) && typeof g.summary === 'string' && Array.isArray(g.recommendations) && g.recommendations.every(v => typeof v === 'string') && Array.isArray(g.rankedVideoIds) && g.rankedVideoIds.every(id => materials.assignments.some(a => a.videoId === id && a.category === g.category)));
}
