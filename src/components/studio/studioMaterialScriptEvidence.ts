import { effectiveClipDuration } from './studioStoryboardMaterialMatching';
import { type Clip } from './studioSourceMaterial';


export function materialRoleLabel(clip: Pick<Clip, 'folder' | 'type'>): string {
  if (clip.folder === 'presenter') return '真人口播素材';
  if (clip.folder === 'detail') return '产品细节素材';
  if (clip.folder === 'factory') return '工厂/实力素材';
  if (clip.folder === 'packaging') return '包装定制素材';
  if (clip.folder === 'certificate') return '证书资质素材';
  if (clip.folder === 'scene') return '场景使用素材';
  if (clip.folder === 'brand') return '品牌视觉素材';
  if (clip.folder === 'hot') return '爆款图文参考';
  if (clip.folder === 'model') return '模特/效果素材';
  if (clip.type === 'image') return '静态产品图';
  return '产品展示素材';
}

export function buildMaterialInfosForScript(clips: Clip[], totalDuration: number, hookMaterialId = '') {
  const usable = clips.filter(item => item.type !== 'audio');
  let cursor = 0;
  const result = usable.reduce<Array<{
    name: string; type: Clip['type']; folder: string; duration: number; effectiveDuration: number; role: string;
    targetStart: number; targetEnd: number; industry?: string; shotFunction?: string; tags?: string; observations?: string[];
  }>>((result, clip) => {
    if (cursor >= totalDuration) return result;
    const effectiveDuration = Math.min(
      clip.id === hookMaterialId && clip.type === 'video' ? Math.max(0.5, clip.duration) : effectiveClipDuration(clip),
      totalDuration - cursor,
    );
    const targetStart = +cursor.toFixed(1);
    const targetEnd = +Math.min(totalDuration, cursor + effectiveDuration).toFixed(1);
    const observations = [...(clip.visualObservations || []), ...(clip.segments || []).filter(segment => !segment.needsReview && Number(segment.confidence) >= .65).slice(0, 6).map(segment => [
      `${segment.start}-${segment.end}s`,
      segment.action,
      segment.shot,
      segment.camera,
      segment.environment,
      segment.productVisible ? `产品清晰度${segment.productClarity}` : '',
      segment.ocrText ? `OCR:${segment.ocrText.slice(0, 120)}` : '',
      segment.needsReview && !segment.manualConfirmed ? '待人工复核' : '',
    ].filter(Boolean).join('；'))];
    result.push({
      name: clip.name,
      type: clip.type,
      folder: clip.folder,
      duration: clip.type === 'image' ? 3 : clip.duration || effectiveDuration,
      effectiveDuration,
      role: materialRoleLabel(clip),
      targetStart,
      targetEnd,
      industry: clip.industry,
      shotFunction: clip.shotFunction,
      tags: clip.tags,
      observations,
    });
    cursor = targetEnd;
    return result;
  }, []);
  const last = result[result.length - 1];
  if (last && totalDuration - last.targetEnd > 0 && totalDuration - last.targetEnd <= 0.75) {
    last.effectiveDuration = +(last.effectiveDuration + totalDuration - last.targetEnd).toFixed(1);
    last.targetEnd = totalDuration;
  }
  if (result.length === 1 && result[0]!.type === 'video') {
    const item = result[0]!;
    const usableDuration = Math.max(0, item.targetEnd - item.targetStart);
    if (usableDuration > 8) {
      const segmentCount = Math.max(3, Math.min(4, Math.ceil(usableDuration / 8)));
      // Reserve a longer final slot for the enterprise's exact CTA instead of
      // forcing a full B2B action into the same short duration as proof shots.
      const segmentDuration = usableDuration / (segmentCount + 1);
      return Array.from({ length: segmentCount }, (_, index) => {
        const targetStart = +(item.targetStart + segmentDuration * index).toFixed(1);
        const targetEnd = +(index === segmentCount - 1
          ? item.targetEnd
          : item.targetStart + segmentDuration * (index + 1)).toFixed(1);
        return {
          ...item,
          effectiveDuration: +(targetEnd - targetStart).toFixed(1),
          role: `${item.role}（连续片段 ${index + 1}/${segmentCount}）`,
          targetStart,
          targetEnd,
          observations: item.observations?.length
            ? item.observations
            : [`同一原始视频的连续时间段 ${targetStart}-${targetEnd}s；只使用该时间段可见内容`],
        };
      });
    }
  }
  return result;
}
