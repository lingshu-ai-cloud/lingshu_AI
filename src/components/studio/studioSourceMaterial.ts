import type { Material, MaterialSegment, StudioProject, SubCue } from '../../lib/studioApi';
import type { VideoKickoff } from './studioVideoKickoff';

export interface Clip {
  transcript?: string;
  transcriptCues?: SubCue[];
  transcriptCuesProvenance?: string;
  transcriptSourceHash?: string;
  id: string;
  name: string;
  folder: string;
  type: 'video' | 'image' | 'audio';
  duration: number; // seconds
  width?: number;
  height?: number;
  aspectRatio?: number;
  size: string;
  url?: string; // 真实素材的可访问地址；缺少时只展示“预览不可用”状态。
  poster?: string; // 封面帧画面（视频抽帧 / 图片自身）
  scope?: 'shared' | 'own'; // 公共库 / 我的（缺省按 own）
  usage?: 'editable' | 'reference_only';
  sourceType?: string;
  generation?: Material['generation'];
  lineage?: Material['lineage'];
  quality?: Material['quality'];
  reuse?: Material['reuse'];
  rightsScope?: string;
  provenance?: Record<string, unknown>;
  materialV2?: Material['materialV2'];
  capabilityManifest?: Material['capabilityManifest'];
  providerTaskId?: string;
  contentSha256?: string;
  industry?: string;
  shotFunction?: string;
  applicability?: string;
  tags?: string;
  productId?: string;
  productName?: string;
  segmentAnalysisStatus?: 'pending' | 'analyzing' | 'completed' | 'failed';
  segmentAnalysisError?: string;
  visualObservations?: string[];
  segments?: MaterialSegment[];
}

export const materialToClip = (m: Material): Clip => ({
  id: m.id, name: m.name, folder: m.folder, type: m.type, duration: m.duration, width: m.width, height: m.height, aspectRatio: m.aspectRatio, size: m.size, url: m.url, poster: m.poster, scope: m.scope ?? 'own',
  usage: m.usage, sourceType: m.sourceType, providerTaskId: m.providerTaskId, contentSha256: m.contentSha256, industry: m.industry, shotFunction: m.shotFunction, applicability: m.applicability, tags: m.tags,
  generation: m.generation, lineage: m.lineage, quality: m.quality, reuse: m.reuse, rightsScope: m.rightsScope, provenance: m.provenance,
  materialV2: m.materialV2, capabilityManifest: m.capabilityManifest,
  productId: m.productId, productName: m.productName,
  transcript: m.transcript, transcriptCues: m.transcriptCues, transcriptCuesProvenance: m.transcriptCuesProvenance,
  transcriptSourceHash: m.transcriptSourceHash,
  segmentAnalysisStatus: m.segmentAnalysisStatus, segmentAnalysisError: m.segmentAnalysisError, segments: m.segments, visualObservations: m.visualObservations,
});

function normalizedSourceToken(value?: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
    url.search = '';
    url.hash = '';
    return `${url.origin}${url.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return raw.split(/[?#]/, 1)[0]!.replace(/\/$/, '').toLowerCase();
  }
}

function kickoffSourceTokens(kickoff: VideoKickoff | null): string[] {
  if (!kickoff) return [];
  const values = [
    kickoff.generatedVideo?.id,
    kickoff.generatedVideo?.material?.id,
    kickoff.video?.referenceRecordId,
    kickoff.video?.sourceUrl,
    kickoff.video?.videoUrl,
    kickoff.video?.aiAnalysis?.materialUrl,
    kickoff.generatedVideo?.url,
  ];
  return [...new Set(values.map(normalizedSourceToken).filter(Boolean))];
}

export function isProductionEligibleClip(clip: Clip, kickoff: VideoKickoff | null): boolean {
  if (clip.usage === 'reference_only' || clip.sourceType === 'historical-kickoff') return false;
  const referenceTokens = new Set(kickoffSourceTokens(kickoff));
  return ![clip.id, clip.url].map(normalizedSourceToken).filter(Boolean).some(token => referenceTokens.has(token));
}

export function isAutomaticViralMaterialCandidate(clip: Clip, kickoff: VideoKickoff | null): boolean {
  return isProductionEligibleClip(clip, kickoff) && clip.sourceType !== 'digital_human';
}

export function projectMatchesKickoff(project: StudioProject, kickoff: VideoKickoff): boolean {
  const savedKickoff = project.spec?.videoKickoff as VideoKickoff | undefined;
  if (!savedKickoff) return false;
  const incomingTokens = kickoffSourceTokens(kickoff);
  const savedTokens = new Set(kickoffSourceTokens(savedKickoff));
  if (incomingTokens.some(token => savedTokens.has(token))) return true;
  if (incomingTokens.length || savedTokens.size) return false;
  return Boolean(
    kickoff.source
    && kickoff.source === savedKickoff.source
    && kickoff.video?.title
    && kickoff.video.title.trim() === savedKickoff.video?.title?.trim()
    && kickoff.video?.platform === savedKickoff.video?.platform,
  );
}

export function normalizeClipSnapshot(value: unknown): Clip | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<Clip>;
  if (!item.id || typeof item.id !== 'string') return null;
  const type = item.type === 'image' || item.type === 'audio' || item.type === 'video' ? item.type : 'video';
  const url = typeof item.url === 'string' ? item.url : '';
  const poster = typeof item.poster === 'string' ? item.poster : '';
  if (!url && !poster) return null;
  return {
    id: item.id,
    name: typeof item.name === 'string' && item.name.trim() ? item.name : '历史作品集素材',
    folder: typeof item.folder === 'string' && item.folder.trim() ? item.folder : 'upload',
    type,
    duration: Number(item.duration) || 0,
    width: Number(item.width) || undefined,
    height: Number(item.height) || undefined,
    aspectRatio: Number(item.aspectRatio) || undefined,
    size: typeof item.size === 'string' && item.size.trim() ? item.size : '作品集快照',
    url,
    poster,
    scope: item.scope === 'shared' ? 'shared' : 'own',
    usage: item.usage,
    sourceType: typeof item.sourceType === 'string' && item.sourceType.trim() ? item.sourceType : 'project-snapshot',
    contentSha256: item.contentSha256,
    industry: item.industry,
    shotFunction: item.shotFunction,
    applicability: item.applicability,
    tags: item.tags,
    productId: item.productId,
    productName: item.productName,
    materialV2: item.materialV2,
    capabilityManifest: item.capabilityManifest,
    segmentAnalysisStatus: item.segmentAnalysisStatus,
    segments: item.segments,
    transcript: item.transcript,
    transcriptCues: item.transcriptCues,
    transcriptCuesProvenance: item.transcriptCuesProvenance,
    transcriptSourceHash: item.transcriptSourceHash,
  };
}

export function kickoffClipSnapshot(kickoff: VideoKickoff | null): Clip | null {
  if (!kickoff) return null;
  if (kickoff.generatedVideo?.material) {
    return normalizeClipSnapshot({ ...materialToClip(kickoff.generatedVideo.material), sourceType: 'historical-kickoff' });
  }
  const url = kickoff.generatedVideo?.url || kickoff.video?.aiAnalysis?.materialUrl || kickoff.video?.videoUrl || '';
  const poster = kickoff.generatedVideo?.poster || kickoff.video?.aiAnalysis?.materialPoster || kickoff.video?.thumbnail || '';
  if (!url && !poster) return null;
  return normalizeClipSnapshot({
    id: kickoff.generatedVideo?.id || `historical-kickoff-${url || poster || kickoff.video?.title || 'video'}`,
    name: kickoff.generatedVideo?.title || kickoff.video?.title || '历史对标视频',
    folder: kickoff.source === 'material_library' ? 'hot' : 'upload',
    type: kickoff.video?.contentFormat === 'image' ? 'image' : 'video',
    duration: kickoff.generatedVideo?.duration || kickoff.video?.duration || 0,
    size: '历史作品集',
    url,
    poster,
    scope: 'own',
    sourceType: 'historical-kickoff',
  });
}
