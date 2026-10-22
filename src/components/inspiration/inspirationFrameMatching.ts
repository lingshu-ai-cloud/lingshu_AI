import type { Material, MaterialSegment } from '../../lib/studioApi';
import type { FrameMaterialMatch, ScriptDetail15s } from '../../lib/inspirationTypes';

export function shortenText(text: string, max = 72): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function tokenizeForMatch(...values: string[]): string[] {
  const stop = new Set(['the', 'and', 'with', 'this', 'that', 'for', 'you', 'your', 'our', '字幕', '画面', '镜头', '固定', '中近景', '特写']);
  return Array.from(new Set(values.join(' ')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^a-z0-9\u4e00-\u9fa5]+/)
    .map(item => item.trim())
    .filter(item => item.length > 1 && !stop.has(item))));
}

function shootingSuggestion(detail: ScriptDetail15s): string {
  const text = `${detail.visual} ${detail.subtitle}`.toLowerCase();
  if (/face|脸|skin|肤|acne|dry|保湿|护肤|洁面|妆|唇|lip/.test(text)) {
    return '优先匹配已有的人物动作素材或数字人/合成路线；只有镜头必须承担真实使用效果证据且无可替代证据时，才建议用户自愿补拍。';
  }
  if (/package|包装|logo|brand|瓶|罐|产品|product|texture|质地/.test(text)) {
    return '优先使用清晰产品图、标签稿与确定性像素合成锁定身份，再由现有动效或 AIGC 能力补充环境和运动；实拍仅作可选兜底。';
  }
  if (/factory|工厂|warehouse|生产|发货|ship|proof|证明/.test(text)) {
    return '优先检索已授权或可复用的工厂/履约场景底板；若没有客户真实证据则改写为流程说明，不把通用画面包装成客户工厂。';
  }
  return '优先从企业素材、共享素材、动效、数字人与已接入 AIGC 能力中选择可执行路线；实拍是用户主动选择的补充方式。';
}

export function parseFrameTimeRange(time: string): { start: number; end: number; duration: number } {
  const values = Array.from(String(time).matchAll(/(\d+(?:\.\d+)?)/g)).map(match => Number(match[1]));
  const start = Math.max(0, values[0] ?? 0);
  const end = Math.max(start + 3, values[1] ?? start + 3);
  return { start, end, duration: Math.max(1, end - start) };
}

function formatClipTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const min = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  const decimal = Math.round((safe - Math.floor(safe)) * 10);
  return decimal > 0
    ? `${min}:${String(sec).padStart(2, '0')}.${decimal}`
    : `${min}:${String(sec).padStart(2, '0')}`;
}

function viralDnaForFrame(detail: ScriptDetail15s): FrameMaterialMatch['viralDna'] {
  const text = `${detail.visual} ${detail.subtitle} ${detail.onScreenText}`;
  const start = parseFrameTimeRange(detail.time).start;
  const inferredPurpose = /cta|购买|下单|咨询|选择|了解更多|关注/i.test(text) ? '行动号召'
    : /前后|对比|效果|证明|测试|数据|认证/i.test(text) ? '效果/信任证明'
    : /切换|下一款|另一款|系列|多款/i.test(text) ? '产品切换与信息递进'
    : /质地|挤出|涂抹|泡沫|吸收/i.test(text) ? '质地或使用证明'
    : /完整|正面|包装|标签|logo|产品特写/i.test(text) ? '产品揭晓与识别'
    : start <= 3 ? '开场注意力钩子' : '叙事推进';
  const explicitPurpose = detail.purpose?.trim() || '';
  const purpose = !explicitPurpose || /承接叙事信息|叙事推进|画面承接/.test(explicitPurpose) ? inferredPurpose : explicitPurpose;
  const action = detail.beats?.map(item => item.action).filter(Boolean).join(' → ') || detail.visual;
  const authenticityRequired = /真实|不得ai|真人|证明|认证|效果|对比/i.test(`${detail.authenticity} ${purpose}`);
  const mustPreserve = Array.from(new Set([
    action ? `动作/信息节拍：${shortenText(action, 64)}` : '',
    detail.shot ? `景别：${detail.shot}` : '',
    detail.camera ? `运镜：${detail.camera}` : '',
    detail.composition ? `构图：${shortenText(detail.composition, 36)}` : '',
  ].filter(Boolean)));
  const replaceable = [
    /人物|真人|脸|手|person|face|hand/i.test(text) ? '人物换成企业适配的真人/达人' : '',
    /产品|包装|瓶|罐|洁面|cream|cleanser|product/i.test(text) ? '产品与包装换成企业自有产品' : '',
    detail.subtitle || detail.onScreenText ? '原字幕/品牌词改为已核验的企业卖点' : '补充企业品牌视觉，但不改变原镜头节拍',
  ].filter(Boolean);
  return {
    purpose,
    mustPreserve,
    replaceable: Array.from(new Set(replaceable)),
    authenticityRequired,
  };
}

function viralPotentialForFrame(detail: ScriptDetail15s, dna: FrameMaterialMatch['viralDna']): FrameMaterialMatch['viralPotential'] {
  // 模型已按本镜头实际内容给出判断时直接采用。下方关键词计分只是历史记录的兜底——
  // 它基础分 38，命中任一关键词即落进 50-74 的“良”，几乎所有镜头同一档，分不出差别。
  const fromModel = detail.viralPotential;
  if (fromModel && typeof fromModel.score === 'number') {
    return {
      score: Math.max(0, Math.min(100, Math.round(fromModel.score))),
      whyEffective: fromModel.whyEffective || '模型未给出说明。',
      mechanisms: (fromModel.mechanisms || []).slice(0, 4),
    };
  }
  const text = `${dna.purpose} ${detail.visual} ${detail.subtitle} ${detail.onScreenText}`;
  const mechanisms: string[] = [];
  let score = 38;
  if (parseFrameTimeRange(detail.time).start <= 3) { mechanisms.push('前3秒注意力入口'); score += 16; }
  if (/钩子|悬念|遮挡|隐藏|反差|意外|问题/i.test(text)) { mechanisms.push('悬念/反差'); score += 16; }
  if (/揭晓|完整|正面|切换|系列|多款/i.test(text)) { mechanisms.push('渐进揭晓'); score += 12; }
  if (/证明|效果|对比|测试|认证|口碑/i.test(text)) { mechanisms.push('证据前置'); score += 14; }
  if (/cta|购买|咨询|选择|行动号召/i.test(text)) { mechanisms.push('转化承接'); score += 10; }
  if (detail.beats?.length) { mechanisms.push('镜头内节拍'); score += 6; }
  if (detail.onScreenText || detail.subtitle) { mechanisms.push('画面信息同步'); score += 4; }
  const unique = Array.from(new Set(mechanisms));
  const mechanismText = unique.length ? unique.slice(0, 2).join('＋') : '明确主体与信息推进';
  return {
    score: Math.max(0, Math.min(100, score)),
    whyEffective: `${mechanismText}，让观众在${formatClipTime(parseFrameTimeRange(detail.time).duration)}内理解“${dna.purpose}”，并推动继续观看或完成判断。`,
    mechanisms: unique,
  };
}

function replicabilityForFrame(detail: ScriptDetail15s, dna: FrameMaterialMatch['viralDna'], matched: ReturnType<typeof scoreSegmentForFrame> | undefined, status: FrameMaterialMatch['status']): FrameMaterialMatch['replicability'] {
  const text = `${detail.visual} ${detail.subtitle} ${detail.onScreenText} ${detail.authenticity}`;
  const exactProduct = /包装|标签|logo|型号|认证|效果证明|真实产品|不得ai/i.test(text);
  const humanAction = /真人|人物|脸|眼|手部|涂抹|佩戴|口播/i.test(text);
  const aiFeasibility: FrameMaterialMatch['replicability']['aiFeasibility'] = exactProduct ? 'low' : humanAction ? 'medium' : 'high';
  const localCoverage = matched ? Math.max(0, Math.min(100, matched.score)) : 0;
  const blockers = [...(matched?.risks || [])];
  if (!matched && exactProduct) blockers.push('缺少可锁定产品身份的图片或视频');
  if (!matched && humanAction) blockers.push('缺少可直接复用的人物动作素材，需由系统选择数字人、素材或合成路线');
  if (dna.authenticityRequired && !matched?.segment.manualConfirmed) blockers.push('真实性要求尚未人工确认');
  const uniqueBlockers = Array.from(new Set(blockers));
  const recommendedExecution: FrameMaterialMatch['replicability']['recommendedExecution'] = matched && status === 'high' ? 'local'
    : matched ? 'local_plus_ai'
    : aiFeasibility === 'high' ? 'ai'
    : 'system_route';
  let score = Math.round(localCoverage * .65 + (aiFeasibility === 'high' ? 28 : aiFeasibility === 'medium' ? 18 : 6) + (dna.replaceable.length ? 8 : 0));
  if (dna.authenticityRequired && !matched?.segment.manualConfirmed) score = Math.min(score, 59);
  return { score: Math.max(0, Math.min(100, score)), localCoverage, aiFeasibility, recommendedExecution, blockers: uniqueBlockers.slice(0, 4) };
}

function normalizedOverlap(left: unknown, right: unknown): number {
  const tokens = tokenizeForMatch(String(left ?? ''));
  if (!tokens.length) return 0;
  const haystack = String(right ?? '').toLowerCase();
  return Math.min(100, Math.round(tokens.filter(token => haystack.includes(token)).length / tokens.length * 100));
}

function scoreSegmentForFrame(material: Material, segment: MaterialSegment, detail: ScriptDetail15s, used: Set<string>) {
  const dna = viralDnaForFrame(detail);
  // Older saved segment analyses may predate these array fields. Treat missing
  // evidence as empty instead of crashing the entire inspiration dashboard.
  const functions = Array.isArray(segment.recommendedFunctions) ? segment.recommendedFunctions : [];
  const subjects = Array.isArray(segment.subject) ? segment.subject : [];
  const logoText = Array.isArray(segment.logoText) ? segment.logoText : [];
  const frameText = `${detail.purpose} ${detail.visual} ${detail.beats?.map(item => item.action).join(' ')} ${detail.shot} ${detail.angle} ${detail.composition} ${detail.camera}`;
  const needsProduct = /产品|包装|瓶|罐|质地|product|package|bottle|texture/i.test(frameText);
  const needsPerson = /人物|真人|男性|女性|脸|眼|皮肤|手|person|face|eye|skin|hand/i.test(frameText);
  const risks: string[] = [];
  if (needsProduct && !segment.productVisible) risks.push('硬条件不满足：分镜要求产品，但片段未识别到产品');
  if (needsProduct && /完整|正面|清晰|特写|reveal/i.test(frameText) && segment.productClarity !== 'high') risks.push('硬条件不满足：产品揭晓需要清晰完整产品');
  if (needsPerson && !segment.hasPerson) risks.push('硬条件不满足：分镜要求真人/手部动作');
  if (dna.authenticityRequired && segment.needsReview && !segment.manualConfirmed) risks.push('真实性镜头尚未人工确认');
  if (segment.hasLogo && logoText.length) risks.push(`检测到文字/品牌：${logoText.join('、')}`);

  const functionScore = normalizedOverlap(detail.purpose || '', functions.join(' '));
  const action = normalizedOverlap(`${detail.visual} ${detail.beats?.map(item => item.action).join(' ')}`, segment.action);
  const subject = normalizedOverlap(detail.visual, `${subjects.join(' ')} ${segment.action}`);
  const composition = normalizedOverlap(`${detail.shot} ${detail.angle} ${detail.composition}`, `${segment.shot} ${segment.angle} ${segment.composition}`);
  const camera = normalizedOverlap(detail.camera, segment.camera);
  const frameDuration = parseFrameTimeRange(detail.time).duration;
  const duration = segment.duration >= frameDuration ? 100 : Math.round(segment.duration / frameDuration * 100);
  const quality = Math.max(0, Math.min(100, segment.quality));
  const enterpriseFit = segment.hasLogo ? 30 : segment.productVisible || segment.hasPerson ? 85 : 60;
  let score = Math.round(functionScore * .25 + action * .2 + subject * .15 + composition * .15 + camera * .1 + duration * .05 + enterpriseFit * .05 + quality * .05);
  if (risks.some(item => item.startsWith('硬条件'))) score = Math.min(score, 39);
  if (dna.authenticityRequired && segment.needsReview && !segment.manualConfirmed) score = Math.min(score, 59);
  if (used.has(segment.id)) { score = Math.max(0, score - 10); risks.push('该片段已用于其他分镜'); }
  return {
    material, segment, score,
    scores: { function: functionScore, action, subject, composition, camera, duration, quality, enterpriseFit },
    trim: { start: segment.start, end: segment.end, label: `真实片段 ${formatClipTime(segment.start)}-${formatClipTime(segment.end)}` },
    risks,
  };
}

export function matchMaterialsToFrames(details: ScriptDetail15s[], materials: Material[]): FrameMaterialMatch[] {
  const videos = materials.filter(item => item.type === 'video');
  const analyzed = videos.flatMap(material => (material.segments || []).map(segment => ({ material, segment })));
  const used = new Set<string>();
  return details.map(detail => {
    const dna = viralDnaForFrame(detail);
    const viralPotential = viralPotentialForFrame(detail, dna);
    const candidates = analyzed.map(({ material, segment }) => scoreSegmentForFrame(material, segment, detail, used)).sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const status: FrameMaterialMatch['status'] = !analyzed.length && videos.length ? 'pending_analysis'
      : !best || best.score < 40 ? 'missing' : best.score >= 80 ? 'high' : best.score >= 60 ? 'review' : 'adapt';
    const matched = best && best.score >= 40 ? best : undefined;
    if (matched) used.add(matched.segment.id);
    const replicability = replicabilityForFrame(detail, dna, matched, status);
    const decision: FrameMaterialMatch['decision'] = viralPotential.score >= 70 && replicability.score >= 70 ? 'copy_now'
      : viralPotential.score >= 70 && replicability.aiFeasibility === 'high' ? 'ai_generate'
      : viralPotential.score >= 70 ? 'route_required'
      : replicability.score >= 60 ? 'supporting_only' : 'drop';
    return {
      detail,
      material: matched?.material,
      segment: matched?.segment,
      score: matched?.score ?? 0,
      scores: matched?.scores,
      trim: matched?.trim,
      reason: status === 'pending_analysis' ? '现有视频尚未完成片段级分析，不能生成可信截取建议'
        : matched ? `按镜头功能、动作节拍、主体、构图与运镜匹配真实片段` : '没有片段通过硬条件，需由系统在素材复用、合成、AIGC 与可选实拍之间选路',
      risks: matched?.risks ?? [],
      suggestion: shootingSuggestion(detail),
      status,
      viralDna: dna,
      viralPotential,
      replicability,
      decision,
    };
  });
}
