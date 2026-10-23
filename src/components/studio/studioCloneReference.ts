import { hasUnnaturalVoiceover, compactComparable } from './studioVoiceoverRules';
import type { VideoKickoff } from './studioVideoKickoff';
import { type MigrationMode } from './studioReferenceAdmission';
import { normalizeScriptTimestamps } from './studioLanguageRules';
import { sanitizeStoryboardScript } from './studioScriptSanitization.js';

export function cloneReferenceAnalysisText(kickoff: VideoKickoff): string {
  const ref = kickoff.referenceAnalysis;
  if (!ref) return '';
  const details = (ref.details || [])
    .map(item => [
      normalizeScriptTimestamps(`[${item.time}]`),
      item.environment ? `环境：${item.environment}` : '',
      item.purpose ? `镜头功能：${item.purpose}` : '',
      item.visual ? `画面：${item.visual}` : '',
      item.shot ? `景别：${item.shot}` : '',
      item.camera ? `运镜：${item.camera}` : '',
      item.dialogue ? `口播：${item.dialogue}` : '口播：无',
      item.onScreenText || item.subtitle ? `屏幕文字：${item.onScreenText || item.subtitle}` : '屏幕文字：无',
      item.ambientSound ? `环境声：${item.ambientSound}` : '',
      item.bgm || item.audio ? `配乐：${item.bgm || item.audio}` : '',
      item.soundEffects?.length ? `音效：${item.soundEffects.join('、')}` : '',
      item.persistentState ? `持续状态：${item.persistentState}` : '',
      item.beats?.length ? `镜头内节拍：${item.beats.map(beat => `[${beat.time || '镜头内'}] ${beat.action || ''}${beat.dialogue ? `／口播：${beat.dialogue}` : ''}${beat.onScreenText ? `／字幕：${beat.onScreenText}` : ''}`).join('；')}` : '',
      item.authenticity ? `真实性要求：${item.authenticity}` : '',
      item.needsReview ? `编导 Agent 自动补证：待完成（置信度${Math.round((item.confidence ?? 0) * 100)}%）` : '',
      item.note ? `备注：${item.note}` : '',
    ].filter(Boolean).join('；'))
    .join('\n');
  return [
    ref.visualStyle ? `结构风格：${ref.visualStyle}` : '',
    ref.coreEmotion ? `情绪节奏：${ref.coreEmotion}` : '',
    details ? `对标视频脚本详析（必须逐段依据，时间/环境/景别/运镜/配乐/动作节奏优先保持）：\n${details}` : '',
  ].filter(Boolean).join('\n\n');
}

export function cloneReferenceHighlights(kickoff: VideoKickoff): string[] {
  const ref = kickoff.referenceAnalysis;
  const out = [
    ref?.visualStyle ? `画风：${ref.visualStyle}` : '',
    ref?.coreEmotion ? `情绪：${ref.coreEmotion}` : '',
    ...(ref?.details || []).slice(0, 12).map(item => `${item.time} ${item.environment || ''} ${item.shot}/${item.camera}：${item.visual || item.note || item.subtitle || '按原分镜动作节奏复刻'}`),
  ].filter(Boolean);
  return out.length ? out : ['复刻对标视频的开头钩子、情绪节奏、镜头关系和转化 CTA。'];
}

export function isStandardCloneStoryboard(value: string): boolean {
  const text = String(value || '');
  if (!text.trim()) return false;
  const required = ['环境', '景别', '运镜', '画面', '配乐', '台词', '字幕'];
  const hasAllFields = required.every(label => new RegExp(`${label}[：:]`).test(text));
  const oldSparseFormat = /人物说[：:]|采购这类|真实使用场景|痛点特写|买家最关心的结果|先看真实使用效果|把「[^」]+」放到真实使用场景/.test(text);
  return hasAllFields && !oldSparseFormat && !hasUnnaturalVoiceover(text);
}

export function ensureStandardCloneStoryboard(value: string, kickoff: VideoKickoff, productInfo: string, languageCode: string, strictProductName?: string, migrationMode: MigrationMode = 'structure'): { script: string; normalized: boolean } {
  const sanitized = sanitizeStoryboardScript(value, productInfo, strictProductName).trim();
  if (isStandardCloneStoryboard(sanitized)) return { script: sanitized, normalized: false };
  return { script: '', normalized: true };
}

export function cloneScriptSimilarity(a: string, b: string): number {
  const grams = (value: string) => {
    const normalized = compactComparable(value)
      .replace(/脚本\d+|当前|环境|景别|运镜|画面|配乐|台词|字幕/g, '');
    const out = new Set<string>();
    for (let i = 0; i < Math.max(1, normalized.length - 1); i += 1) out.add(normalized.slice(i, i + 2));
    return out;
  };
  const left = grams(a);
  const right = grams(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  left.forEach(item => { if (right.has(item)) overlap += 1; });
  return overlap / Math.max(left.size, right.size);
}

export function isDuplicateCloneScript(candidate: string, existingScripts: string[]): boolean {
  return existingScripts.some(item => cloneScriptSimilarity(candidate, item) > 0.82);
}

export function cloneScriptMaxSimilarity(candidate: string, existingScripts: string[]): number {
  return existingScripts.reduce((max, item) => Math.max(max, cloneScriptSimilarity(candidate, item)), 0);
}

export function ensureDistinctCloneStoryboard(input: {
  script: string;
  kickoff: VideoKickoff;
  productInfo: string;
  languageCode: string;
  strictProductName?: string;
  existingScripts: string[];
  variantSeed: number;
  migrationMode?: MigrationMode;
}) {
  let normalized = ensureStandardCloneStoryboard(input.script, input.kickoff, input.productInfo, input.languageCode, input.strictProductName, input.migrationMode);
  if (!isDuplicateCloneScript(normalized.script, input.existingScripts)) return normalized;
  return { script: '', normalized: true };
}
