/** Public creative metadata. Storage references and provider credentials never cross this boundary. */
export type PlatformAdCreativeStatus = 'pending' | 'uploading' | 'processing' | 'ready' | 'failed' | 'unknown';
export interface PlatformAdCreative {
  id: string; taskId: string; taskVersion: number; sourceTaskId: string; artifactId: string;
  sha256: string; mimeType: string; size: number; name: string; connectionId: string;
  provider: 'meta' | 'tiktok'; platformVideoId: string; status: PlatformAdCreativeStatus;
  createdAt: string; updatedAt: string;
  videoReuse?: { verifiedAt: string };
}
export interface PlatformAdCreativeSource {
  sourceTaskId: string; artifactId: string; name: string; mimeType: string; size: number; sha256: string;
}
export interface AdMaterialSelection extends PlatformAdCreativeSource {
  origin: 'social'; sourceTenantId: string; sourceTenantName: string;
  contentStatus?: string;
}
export function adContentStatusLabel(status?: string): string {
  if (!status) return '未返回';
  return ({ draft: '尚未确认', review_required: '待内容确认', approved: '已确认', superseded: '有更新版本', rejected: '内容未通过', failed: '内容处理失败' } as Record<string, string>)[status] || status;
}
export function adCreativeAvailabilityLabel(creative: PlatformAdCreative): string {
  if (creative.status === 'ready' && creative.videoReuse) return '已复用 Meta 视频';
  return ({ pending: '本地绑定 · 未上传', uploading: '上传中', processing: '平台处理中', ready: '平台视频已就绪', failed: '上传失败', unknown: '结果待核对' })[creative.status];
}
