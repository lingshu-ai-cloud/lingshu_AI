import { mediaType } from '../../lib/studioFileInputs';
import { type Material } from '../../lib/studioApi';
import { type Clip } from './studioSourceMaterial';
import type { VideoThemeId, StoryboardSourceMode } from './studioWorkspaceContracts.js';

export function inferVideoThemeFromMaterial(material: Pick<Material, 'name' | 'folder' | 'shotFunction' | 'tags' | 'segments'>): VideoThemeId {
  const segmentText = (material.segments || []).flatMap(segment => [
    segment.action, segment.environment, segment.shot, ...segment.subject, ...segment.recommendedFunctions,
  ]).join(' ');
  const text = [material.name, material.folder, material.shotFunction, material.tags, segmentText].filter(Boolean).join(' ').toLowerCase();
  if (/对比|比较|选型|差异|before.?after|comparison|versus|\bvs\b/.test(text)) return 'comparison';
  if (/客户案例|合作案例|案例结果|反馈|testimonial|customer.?case|case.?study/.test(text)) return 'customer_case';
  if (/趋势|热点|热销|爆款|trend|viral|hot.?selling/.test(text)) return 'trend';
  if (/工厂|产线|生产|质检|仓库|物流|交付|设备|factory|production|quality.?control|warehouse|logistics/.test(text)) return 'supplier_capability';
  if (/定制|包装|彩盒|贴牌|logo|品牌|custom|oem|odm|packaging|branding/.test(text)) return 'customization';
  if (/使用|涂抹|体验|操作|场景|护理|application|usage|lifestyle|treatment/.test(text)) return 'use_case';
  if (/产品|质地|细节|成分|特写|展示|product|texture|ingredient|detail|close.?up/.test(text)) return 'product_proof';
  return 'buyer_pain';
}

export function mergeClipLists(primary: Clip[], fallback: Clip[]): Clip[] {
  const byId = new Map<string, Clip>();
  for (const item of fallback) byId.set(item.id, item);
  for (const item of primary) {
    const existing = byId.get(item.id);
    byId.set(item.id, existing
      ? {
          ...existing,
          ...item,
          url: item.url || existing.url,
          poster: item.poster || existing.poster,
          segments: item.segments?.length ? item.segments : existing.segments,
        }
      : item);
  }
  return Array.from(byId.values());
}

export const renderCombinationKey = (planId: string, language: string, bgmId: string) =>
  `${encodeURIComponent(planId)}::${encodeURIComponent(language)}::${encodeURIComponent(bgmId || 'none')}`;

export const materialVersionKey = (planId: string, language: string) =>
  `${encodeURIComponent(planId)}::${encodeURIComponent(language)}`;

export const clipSourceMode = (clip: Clip): Extract<StoryboardSourceMode, 'online' | 'local' | 'ai'> => {
  const marker = `${clip.sourceType || ''} ${clip.id} ${clip.name} ${clip.size} ${clip.url || ''}`.toLowerCase();
  if (/\b(ai|gemini|seedance|jimeng|即梦|生成)\b/.test(marker)) return 'ai';
  if (clip.scope === 'shared') return 'online';
  return 'local';
};

export const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export const fmtTime = (s: number) => `0:${String(Math.round(s)).padStart(2, '0')}`;

export function automaticStoryboardTrim(sourceDuration: number, storyboardDuration: number, mediaType: 'video' | 'image' = 'video') {
  const targetDuration = Math.max(0.5, Number(storyboardDuration) || 0.5);
  const availableDuration = mediaType === 'image'
    ? targetDuration
    : Math.max(0.5, Number(sourceDuration) || targetDuration);
  return {
    trimStart: 0,
    trimEnd: Math.min(availableDuration, targetDuration),
    targetDuration,
  };
}

export function resolveWorkbenchSeekTime(formalPreview: boolean, timelineTime: number, sourceTime: number): number {
  return Math.max(0, formalPreview ? timelineTime : sourceTime);
}
