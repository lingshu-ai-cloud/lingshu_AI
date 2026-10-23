import { cleanVoiceoverLine, humanizeVoiceLine, compactComparable } from './studioVoiceoverRules';
import { normalizeScriptTimestamps } from './studioLanguageRules';
import { compact } from './studioScriptQualityPresentation.js';
import { selectedProductLabel } from './studioProductSelection.js';

export function stableScriptVersion(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `script-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function stripCloneAnalysisSummary(value: string): string {
  const text = String(value || '').trim();
  if (!text) return '';
  const forbiddenBlockRe = /^\s*(?:【?\s*)?(?:基础要求|分析摘要|竞品识别|产品替换|参考爆款|成片目标|指定画风|核心情绪|参考品牌|口播语言|爆点拆解|产品承接|Purpose|Creative style|Core emotion|Product replacement|Voiceover language|Goal|Storyboard)(?:\s*】)?\s*[：:].*$/i;
  const firstTimestamp = text.search(/(?:^|\n)\s*(?:\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\]|Scene\s+\d+\s*\()/i);
  if (firstTimestamp > 0) {
    const head = text.slice(0, firstTimestamp);
    if (/基础要求|分析摘要|竞品识别|产品替换|参考爆款|成片目标|指定画风|核心情绪|对标视频|参考品牌|口播语言/.test(head)) {
      return text.slice(firstTimestamp).trim();
    }
  }
  return text
    .split(/\n+/)
    .filter(line => !forbiddenBlockRe.test(line))
    .join('\n')
    .trim();
}

export function isExplicitNoVoiceMarker(value: string): boolean {
  return /^(?:无|none|no\s+voiceover)$/i.test(cleanVoiceoverLine(value).replace(/[。.!！]$/, '').trim());
}

export function enforceScriptProduct(value: string, productInfo: string, strictProductName?: string): string {
  const productName = compact(strictProductName) || selectedProductLabel(productInfo);
  let next = stripCloneAnalysisSummary(value);
  if (productName) {
    next = next
      .replace(/「企业产品组合」|“企业产品组合”|企业产品组合/g, `「${productName}」`)
      .replace(/「主推产品」|“主推产品”|主推产品/g, `「${productName}」`)
      .replace(/把「[^」]{0,24}企业产品组合[^」]{0,24}」/g, `把「${productName}」`)
      .replace(/\bthis product\b/gi, productName);
  }
  return next;
}

export function sanitizeStoryboardScript(value: string, productInfo: string, strictProductName?: string): string {
  const enforced = enforceScriptProduct(value, productInfo, strictProductName);
  const lines = enforced.split('\n');
  const out: string[] = [];
  let lastVoiceKey = '';
  let currentVoice = '';
  let currentOriginalVoiceKey = '';

  for (const raw of lines) {
    let line = raw.trimEnd();
    line = line
      .replace(/[；;，,]?\s*只参考对标视频的[^。\n]*?(?:。|$)/g, '')
      .replace(/[；;，,]?\s*不继承原视频[^。\n]*?(?:。|$)/g, '')
      .replace(/[；;，,]?\s*第\s*\d+\s*段只参考[^。\n]*?(?:。|$)/g, '')
      .replace(/[；;，,]?\s*行业\/品类\/产品必须替换为[^。\n]*?(?:。|$)/g, '')
      .trimEnd();
    if (!line.trim()) continue;
    if (/^\s*(?:\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?|Scene\s+\d+\s*\()/i.test(line)) {
      currentVoice = '';
      currentOriginalVoiceKey = '';
      // Repeated narration in different shots is intentional timeline data.
      // Only duplicate voice fields inside the same shot may be collapsed.
      lastVoiceKey = '';
    }
    const voiceMatch = line.match(/^(\s*(?:人物说|台词|Voiceover|VO|口播)\s*[：:]\s*)(.+)$/i);
    if (voiceMatch) {
      const prefix = voiceMatch[1] || '';
      const originalVoice = cleanVoiceoverLine(voiceMatch[2] || '');
      currentOriginalVoiceKey = compactComparable(originalVoice);
      if (isExplicitNoVoiceMarker(originalVoice)) {
        currentVoice = originalVoice;
        out.push(`${prefix}${originalVoice}`);
        continue;
      }
      const voice = humanizeVoiceLine(voiceMatch[2] || '');
      const key = compactComparable(voice);
      if (!voice || (key && key === lastVoiceKey)) continue;
      currentVoice = voice;
      lastVoiceKey = key;
      out.push(`${prefix}${voice}`);
      continue;
    }

    const subtitleMatch = line.match(/^(\s*(?:字幕|Subtitle|Caption)\s*[：:]\s*)(.+)$/i);
    if (subtitleMatch) {
      const subtitle = cleanVoiceoverLine(subtitleMatch[2] || '');
      const subtitleKey = compactComparable(subtitle);
      const voiceKey = compactComparable(currentVoice);
      if (!subtitle) continue;
      // A subtitle mirroring narration is required storyboard structure, not
      // duplicate prose. Preserve the field and keep it synchronized if the
      // narration was humanized above.
      const mirrorsVoice = Boolean(voiceKey && (subtitleKey === voiceKey || voiceKey.includes(subtitleKey) || subtitleKey.includes(voiceKey)))
        || Boolean(currentOriginalVoiceKey && (subtitleKey === currentOriginalVoiceKey
          || currentOriginalVoiceKey.includes(subtitleKey)
          || subtitleKey.includes(currentOriginalVoiceKey)));
      out.push(`${subtitleMatch[1]}${mirrorsVoice ? currentVoice : subtitle}`);
      continue;
    }

    out.push(line);
  }

  return normalizeScriptTimestamps(out.join('\n').replace(/\n{3,}/g, '\n\n').trim());
}
