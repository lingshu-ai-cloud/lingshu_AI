import { replaceReferenceIdentities } from '../../lib/referenceIdentityMapping';
import { parseCueRange } from './studioVoiceoverRules';
import type { VideoKickoff } from './studioVideoKickoff';

/** Keep the source ASR sentence order while the observed visual cuts define production shots. */
export function referenceProductSlots(kickoff: VideoKickoff | null): Array<{ shotId: string; sourceLabel: string; time: string; visual: string }> {
  return (kickoff?.referenceAnalysis?.details || []).flatMap((detail, index) => {
    const range = parseCueRange(detail.time);
    if (!range || index === 0 || range.end - range.start > 2.5
      || !/mask|marks|cream|foundation|essence|oil|shampoo|面膜|修护|美白|粉底|精华|按摩|洗发/i.test(detail.subtitle || '')
      || /实验服|工人|灌装|传送带|试剂|设备|实验台|生产线/.test((detail.visual || '').slice(0, 45))) return [];
    return [{ shotId: detail.shotId || `reference-shot-${index + 1}`, sourceLabel: detail.subtitle?.trim() || `原片产品 ${index + 1}`, time: detail.time, visual: detail.visual || '' }];
  });
}

type ReferenceProductMapping = { shotId: string; sourceTerm: string; productId: string; productLabel: string };
type ReferenceBrandMapping = { sourceTerm: string; brandLabel: string };

export interface ReferenceSpeechPlan {
  script: string;
  lines: Array<{ id: string; source: string; draft: string; time: string; sourcePrecision?: string; productTerms?: string[]; words?: Array<{start: number; end: number; text: string}>; visuals: Array<{ time: string; label: string; shotId?: string }> }>;
  error?: string;
  fallbackMode?: 'enterprise_script_or_silent_subtitle';
  notice?: string;
}

export function buildReferenceSpeechPlan(kickoff: VideoKickoff | null, productMappings: ReferenceProductMapping[] = [], brandMapping?: ReferenceBrandMapping): ReferenceSpeechPlan {
  const details = kickoff?.referenceAnalysis?.details || [];
  if (!details.length) return { script: '', lines: [], error: '参考视频尚无可用的画面切点。' };
  const lines = new Map<string, { id: string; source: string; draft: string; time: string; sourcePrecision?: string; productTerms?: string[]; words?: Array<{start: number; end: number; text: string}>; visuals: Array<{ time: string; label: string; shotId?: string }> }>();
  const shotRows = details.map((shot, shotIndex) => {
    const range = parseCueRange(shot.time);
    if (!range) return null;
    const ownerId = shot.shotId || `shot-${shotIndex + 1}`;
    const spoken: string[] = [];
    for (const [lineIndex, line] of (shot.speechLines || []).entries()) {
      if (line.narrationOwnerShotId && line.narrationOwnerShotId !== ownerId) continue;
      const source = String(line.referenceText || '').trim();
      const draft = productMappings.length || brandMapping?.sourceTerm
        ? replaceReferenceIdentities(source, productMappings, brandMapping)
        : String(line.draftText || source).trim();
      if (!source || !draft) continue;
      const id = line.lineId || `${ownerId}:${lineIndex}`;
      if (lines.has(id)) continue;
      const start = Number(line.sourceStartSeconds);
      const end = Number(line.sourceEndSeconds);
      const time = Number.isFinite(start) && Number.isFinite(end) && end > start
        ? `${start.toFixed(2)}–${end.toFixed(2)}s` : `${range.start.toFixed(2)}–${range.end.toFixed(2)}s`;
      const visualShots = details.filter(item => (item.speechLines || []).some(speech => speech.lineId === id));
      lines.set(id, { id, source, draft, time, sourcePrecision: line.sourcePrecision, productTerms: kickoff?.referenceAnalysis?.narrationProducts || productMappings.map(mapping => mapping.sourceTerm), words: line.sourceWords, visuals: visualShots.map(item => ({ shotId: item.shotId, time: item.time, label: item.visual || item.shot || '画面待分析' })) });
      spoken.push(draft);
    }
    const mappedProduct = productMappings.find(mapping => mapping.shotId === ownerId);
    return `[${range.start.toFixed(2)}s-${range.end.toFixed(2)}s]\n画面：${shot.visual || shot.shot || '按参考视频画面'}\n${mappedProduct ? `目标产品：${mappedProduct.productLabel}\n` : ''}镜头功能：${shot.purpose || '沿用参考视频表达目的'}\n口播：${spoken.join(' ') || '无'}`;
  }).filter((row): row is string => Boolean(row));
  if (!lines.size) {
    const enterpriseCaption = [...new Set([
      ...productMappings.map(mapping => mapping.productLabel.trim()),
      brandMapping?.brandLabel.trim() || '',
    ].filter(Boolean))].join(' · ');
    const silentScript = shotRows.map(row => `${row}\n字幕：${enterpriseCaption || '无'}`).join('\n\n');
    if (!silentScript.trim()) return { script: '', lines: [], error: '参考视频缺少可用的真实画面切点，暂不能建立分镜。' };
    return {
      script: silentScript,
      lines: [],
      fallbackMode: 'enterprise_script_or_silent_subtitle',
      notice: `参考视频没有可验证的原片口播，已改用${enterpriseCaption ? '企业自有产品字幕' : '无口播字幕'}方案；仅沿用真实画面切点，不推断或伪造原片台词。`,
    };
  }
  const unmatched = productMappings.filter(mapping => mapping.sourceTerm.trim()
    && ![...lines.values()].some(line => line.source.toLocaleLowerCase().includes(mapping.sourceTerm.trim().toLocaleLowerCase())));
  if (unmatched.length) return { script: shotRows.join('\n\n'), lines: [...lines.values()],
    error: `${unmatched.map(mapping => mapping.sourceTerm).join('、')} 未在原片口播中识别到；请核对产品词后再生成配音。` };
  return { script: shotRows.join('\n\n'), lines: [...lines.values()] };
}

/** Apply approved narration edits without rebuilding or dropping visual shots. */
export function confirmReferenceSpeechEdits(plan: ReturnType<typeof buildReferenceSpeechPlan>, confirmedLines: Array<{ id: string; source: string; draft: string; excludedShotIds?: string[] }>): ReturnType<typeof buildReferenceSpeechPlan> {
  if (!confirmedLines.length) throw new Error('没有可确认的新口播。');
  if (confirmedLines.some(item => !item.draft.trim() || !plan.lines.some(line => line.id === item.id && line.source === item.source))) throw new Error('口播来源已变化，请重新确认新口播。');
  const kept = plan.lines.filter(line => confirmedLines.some(item => item.id === line.id));
  const deleted = plan.lines.filter(line => !confirmedLines.some(item => item.id === line.id));
  const replacements = plan.lines.map(line => ({ original: line.draft, edited: confirmedLines.find(item => item.id === line.id)?.draft.trim() || '' }));
  const expression = new RegExp(replacements.map(item => item.original).filter(Boolean).sort((a,b) => b.length-a.length).map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const excludedIds = new Set(confirmedLines.flatMap(line => line.excludedShotIds || []));
  const excludedTimes = new Set(plan.lines.flatMap(line => line.visuals).filter(visual => excludedIds.has((visual as { shotId?: string }).shotId || '')).map(visual => visual.time));
  const removedTimes = new Set(deleted.flatMap(line => line.visuals.map(visual => visual.time)));
  const keptTimes = new Set(kept.flatMap(line => line.visuals.map(visual => visual.time)));
  const script = plan.script.split('\n\n').filter(block => {
    const range = parseCueRange(block.split('\n')[0]);
    return ![...excludedTimes].some(time => { const excluded = parseCueRange(time); return excluded && range && excluded.start === range.start && excluded.end === range.end; }) && ![...removedTimes].some(time => { const removed = parseCueRange(time); return removed && range && removed.start === range.start && removed.end === range.end && !keptTimes.has(time); });
  }).join('\n\n').replace(/^口播：(.*)$/gm, (_row, speech: string) => `口播：${speech.replace(expression, match => replacements.find(item => item.original === match)?.edited ?? match).trim() || '无'}`);
  if (!script.trim()) throw new Error('至少保留一个独立镜头后再进入素材匹配。');
  return { ...plan, script, lines: kept.map(line => ({ ...line, visuals: line.visuals.filter(visual => !excludedIds.has(visual.shotId || '')), draft: confirmedLines.find(item => item.id === line.id)!.draft.trim() })) };
}
