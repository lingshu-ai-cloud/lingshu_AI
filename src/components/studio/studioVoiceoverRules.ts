export function parseCueRange(value: string): { start: number; end: number } | null {
  const match = String(value || '').match(/(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?/i);
  if (!match) return null;
  const start = Number(match[1]);
  const rawEnd = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(rawEnd)) return null;
  return { start: Math.max(0, start), end: Math.max(start + 0.3, rawEnd) };
}

function normalizeTimeLabel(value: string, fallbackIndex: number): string {
  const range = parseCueRange(value);
  if (range) return `[${range.start}-${range.end}s]`;
  const ranges = ['0-3s', '3-8s', '8-15s', '15-20s', '20-25s', '25-30s'];
  return `[${ranges[fallbackIndex] || `${fallbackIndex * 4}-${(fallbackIndex + 1) * 4}s`}]`;
}

function looksLikeProductionInstruction(value: string): boolean {
  return /^(分镜|镜头|画面|音频|注|Shot|Camera|Visual|Subtitle|Caption|Creative style|Core emotion|Goal|Storyboard|Product replacement)\b/i.test(value)
    || /(?:画面|我方画面|参考节奏|字幕|Shot|Camera|Visual|Subtitle)\s*[：:]/i.test(value);
}


// Storyboard rows can be persisted either one field per line or as one packed
// line. Stop at the next field label so an inline `字幕：无` does not make a
// valid `台词：...` look like a production instruction and disappear.
const VOICEOVER_FIELD_RE = /(?:人物说|台词|Voiceover|VO|口播)\s*[：:]\s*(.*?)(?=\s+(?:环境|景别|运镜|构图|镜头功能|画面|Visual|字幕|Caption|屏幕文字|OnScreenText|配乐|音乐|音效|Sound|SFX|BGM|真实性要求|可见事实|表达意图|未展示因果|Omni提示词|Omni禁止项)\s*[：:]|$)/i;
const NON_VOICE_FIELD_RE = /^(?:环境|景别|运镜|构图|镜头功能|画面|Visual|字幕|Caption|屏幕文字|OnScreenText|配乐|音乐|音效|Sound|SFX|BGM|真实性要求|可见事实|表达意图|未展示因果|Omni提示词|Omni禁止项)\s*[：:]/i;

export function hasStoryboardFieldLabels(lines: string[]): boolean {
  return lines.some(raw => {
    const line = raw.trim();
    return VOICEOVER_FIELD_RE.test(line) || NON_VOICE_FIELD_RE.test(line);
  });
}

function looksLikeOnScreenOnlyText(value: string): boolean {
  const text = String(value || '').replace(/\s+/g, '').trim();
  if (!text) return true;
  if (isNonSpeechSfx(text)) return true;
  if (/[｜|]/.test(text)) return true;
  if (/[¥￥$€£]\s*\d/.test(text)) return true;
  if (/^[A-Z][A-Z0-9_-]{2,}(?:-\d+)?$/i.test(text)) return true;
  if (/^[A-Z][A-Z0-9_-]{2,}(?:-\d+)?(?:资料|认证|报价|PDF)$/i.test(text)) return true;
  if (/^[A-Z0-9_-]{2,}[\u4e00-\u9fff]{1,10}(?:\d+款?)?$/i.test(text)) return true;
  if (/^\d+(?:\.\d+)?\s*(?:资料|认证|报价|PDF)$/i.test(text)) return true;
  // Avoid overlapping repetitions that freeze on long Latin identifiers.
  if (/^[A-Z0-9_.-]+$/i.test(text)) return true;
  if (/^(?:按压即发|绵密不塌|现货|秒回PDF|含报价|含认证|非打样|即订即发)$/i.test(text)) return true;
  return false;
}

function looksLikeStandaloneSpeech(value: string): boolean {
  const text = cleanVoiceoverLine(value);
  if (!text || looksLikeOnScreenOnlyText(text) || looksLikeProductionInstruction(text)) return false;
  // Localized narration commonly uses ASCII punctuation (Russian and many
  // European languages in particular). Treat it as spoken prose too; the
  // previous CJK-only punctuation check caused valid translated cues to be
  // dropped before the voiceover validator saw them.
  if (/[，。！？!?؟؛、,.:;]/.test(text)) return true;
  if (/(吗|呢|吧|了|我|你|咱|这|那|真能|不是|马上|直接|发我|留言|私信)/.test(text) && text.length >= 6) return true;
  if (/\s/.test(text) && /^(check|send|watch|see|message|comment|dm|ask|get|try)\b/i.test(text)) return true;
  return text.length >= 6 && /\p{L}/u.test(text);
}

export function cleanVoiceoverLine(value: string): string {
  let text = String(value || '')
    .replace(/^\s*\[[^\]]+\]\s*/g, '')
    .replace(/^(Hook|Body|CTA|口播|字幕|人物说|台词|Voiceover|VO|Caption)\s*[：:·-]?\s*/i, '')
    .replace(/[（(]\s*(?:参考原节奏|参考节奏|原节奏|参考原片|原片|原视频|日文原句|英文原句|韩文原句)[^）)]*[）)]/gi, '')
    .replace(/[（(][^）)]*(?:参考原节奏|参考节奏|原节奏|参考原片|原片|原视频|日文原句|英文原句|韩文原句)[^）)]*[）)]/gi, '')
    .replace(/[（(][^）)]*[\u3040-\u30ff\uac00-\ud7af][^）)]*[）)]/g, '')
    .replace(/\s*(?:参考原节奏|参考节奏|原节奏|参考原片|原片|原视频|日文原句|英文原句|韩文原句)\s*[：:].*$/gi, '')
    .replace(/^["“”]+|["“”]+$/g, '')
    .replace(/^[\d一二三四五六七八九十]+[.、]\s*/, '')
    .trim();
  text = text.replace(/\s{2,}/g, ' ').trim();
  return text;
}

const TECH_TERM_RE = /\b(?:CE|RoHS|UKCA|ETL|IES\/?LDT|LDT|IP\d{2,}|BSCI|REACH|ISO\d*|MOQ|OEM|ODM|SKU)\b|认证资质|认证|型号|光学文件|检测报告|参数|色温|显指|防护等级/gi;

function techTermCount(value: string): number {
  return Array.from(String(value || '').matchAll(TECH_TERM_RE)).length;
}

export function humanizeVoiceLine(value: string): string {
  let text = cleanVoiceoverLine(value);
  const compacted = text.replace(/\s+/g, ' ').trim();
  const terms = techTermCount(compacted);
  const hasCjk = /[\u3400-\u9fff]/.test(compacted);
  const tooDense = terms >= 3 || (hasCjk
    ? Array.from(compacted.replace(/\s/g, '')).length > 58
    : compacted.split(/\s+/).filter(Boolean).length > 20);
  if (!tooDense) return compacted;
  // The deterministic Chinese rewrites below are not translations and must
  // never replace or truncate an English sentence. Let the backend duration
  // validator request a semantic rewrite when an English line is too long.
  if (!hasCjk) return compacted;

  if (/客户问.*价格|问了.*价格|报价|价格/i.test(compacted) && /认证|CE|RoHS|UKCA|ETL|IES|IP\d+/i.test(compacted)) {
    return '客户问完价格，真正担心的是资料能不能一次给齐。先看这个真实效果。';
  }
  if (/认证|CE|RoHS|UKCA|ETL|IES|IP\d+|检测|资质|光学文件/i.test(compacted)) {
    return '认证和检测资料别只写在表格里，先把能确认的文件和实物放一起看。';
  }
  if (/MOQ|数量|包装|标签|目标市场|规格/i.test(compacted)) {
    return '数量、包装和目标市场说清楚，我再给你整理报价和打样方案。';
  }
  if (/参数|色温|显指|亮度|型号/i.test(compacted)) {
    return '别只看参数表，先看现场效果是不是和项目需求对得上。';
  }
  return compacted
    .replace(/(?:认证资质\s*)?(?:CE|RoHS|UKCA|ETL|IES\/?LDT|IP\d{2,}|BSCI|REACH|ISO\d*|[,，、\s]){12,}/gi, '相关认证和检测资料')
    .slice(0, 58)
    .replace(/[，,、;；]\s*$/, '。');
}

export function hasUnnaturalVoiceover(value: string): boolean {
  return String(value || '')
    .split(/\n+/)
    .some(line => {
      const match = line.match(/(?:台词|人物说|Voiceover|VO|口播)\s*[：:]\s*(.+)$/i);
      if (!match?.[1]) return false;
      const text = cleanVoiceoverLine(match[1]);
      return techTermCount(text) >= 3 || text.length > 72 || /CE[、,，\s]+RoHS[、,，\s]+UKCA/i.test(text);
    });
}

function mergeTimestampedVoiceoverSegments(
  segments: Array<{ time: string; text: string }>,
): Array<{ time: string; text: string }> {
  const merged: Array<{ time: string; text: string }> = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (!previous || previous.time !== segment.time) {
      merged.push({ ...segment });
      continue;
    }

    const previousKey = compactComparable(previous.text);
    const currentKey = compactComparable(segment.text);
    if (!currentKey || previousKey === currentKey || previousKey.includes(currentKey)) continue;
    if (currentKey.includes(previousKey)) {
      previous.text = segment.text;
      continue;
    }

    const separator = /[。！？!?]$/.test(previous.text) ? '' : '。';
    previous.text = `${previous.text}${separator}${segment.text}`;
  }
  return merged;
}

export function parseTimestampedVoiceover(value: string): Array<{ time: string; text: string }> {
  const lines = String(value || '').split(/\n+/);
  const segments: Array<{ time: string; text: string }> = [];
  const structuredStoryboard = hasStoryboardFieldLabels(lines);
  let currentTime = '';
  let fallbackIndex = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/(?:参考原节奏|参考节奏|原节奏|参考原片|原片|原视频|日文原句|英文原句|韩文原句)/i.test(line)) continue;
    const timeMatch = line.match(/\[([^\]]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^\]]*)\]/i);
    const sceneTimeMatch = line.match(/Scene\s+\d+\s*\(([^)]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^)]*)\)/i);
    if (timeMatch) currentTime = normalizeTimeLabel(timeMatch[1], fallbackIndex);
    else if (sceneTimeMatch) currentTime = normalizeTimeLabel(sceneTimeMatch[1], fallbackIndex);

    const prefixed = line.match(VOICEOVER_FIELD_RE);
    if (!prefixed && NON_VOICE_FIELD_RE.test(line)) continue;
    const quoted = !prefixed && !structuredStoryboard ? line.match(/[“"]([^”"]{2,})[”"]/) : null;
    const sameLine = timeMatch ? line.replace(timeMatch[0], '').trim() : '';
    // A plain timestamped document is already the extracted voiceover format.
    // Treat every non-empty line as speech instead of sending it through the
    // storyboard/on-screen-text heuristics again; otherwise valid middle cues
    // can disappear when a saved draft is revalidated or translated.
    if (!structuredStoryboard && timeMatch && sameLine && !prefixed) {
      const directText = cleanVoiceoverLine(sameLine);
      if (directText && !looksLikeProductionInstruction(directText) && !isNonSpeechSfx(directText)) {
        segments.push({ time: currentTime || normalizeTimeLabel('', fallbackIndex), text: directText });
        fallbackIndex += 1;
      }
      continue;
    }
    let text = quoted?.[1] || prefixed?.[1] || '';
    if (!text && sameLine && !structuredStoryboard
      && !looksLikeProductionInstruction(sameLine)
      && !looksLikeOnScreenOnlyText(sameLine)) text = sameLine;
    text = cleanVoiceoverLine(text);
    if (!text || looksLikeProductionInstruction(text) || isNonSpeechSfx(text)) continue;
    if (!prefixed && looksLikeOnScreenOnlyText(text)) continue;
    segments.push({ time: currentTime || normalizeTimeLabel('', fallbackIndex), text });
    fallbackIndex += 1;
  }
  if (segments.length) return mergeTimestampedVoiceoverSegments(segments);
  if (structuredStoryboard) return [];
  return Array.from(String(value || '').matchAll(/[“"]([^”"]{2,})[”"]/g))
    .map((match, index) => ({ time: normalizeTimeLabel('', index), text: cleanVoiceoverLine(match[1] || '') }))
    .filter(item => item.text && !isNonSpeechSfx(item.text) && !looksLikeOnScreenOnlyText(item.text));
}


export function formatVoiceoverWithTimestamps(value: string): string {
  const parsed = parseTimestampedVoiceover(value).filter(item => !isNonSpeechSfx(item.text));
  if (parsed.length) return parsed.map(item => `${item.time} ${item.text}`).join('\n');
  if (hasStoryboardFieldLabels(String(value || '').split(/\n+/))) return '';
  const fallback = cleanVoiceoverLine(value);
  return isNonSpeechSfx(fallback) || looksLikeProductionInstruction(fallback) ? '' : fallback;
}

function voiceoverTimelineSignature(value: string): string[] {
  const directTimeline = String(value || '')
    .split(/\n+/)
    .map(line => line.match(/^\s*\[([^\]]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^\]]*)\]/i)?.[1] || '')
    .filter(Boolean)
    .map((time, index) => normalizeTimeLabel(time, index));
  if (directTimeline.length) return directTimeline;
  return parseTimestampedVoiceover(value)
    .filter(item => !isNonSpeechSfx(item.text))
    .map(item => item.time);
}

export function voiceoverDraftCoversSource(sourceVoiceover: string, draft: string): boolean {
  const sourceTimeline = voiceoverTimelineSignature(sourceVoiceover);
  const draftTimeline = voiceoverTimelineSignature(draft);
  if (!sourceTimeline.length) return Boolean(String(draft || '').trim());
  // A one-cue TTS response commonly comes back as plain text. It still covers
  // a one-cue source even though the provider omitted the timestamp wrapper.
  if (!draftTimeline.length) {
    return sourceTimeline.length === 1 && Boolean(formatVoiceoverWithTimestamps(draft).trim());
  }
  return draftTimeline.length === sourceTimeline.length
    && draftTimeline.every((time, index) => time === sourceTimeline[index]);
}

/**
 * A storyboard is the source of truth for which shots contain speech. Keep a
 * manually edited voice draft only when it still covers the exact storyboard
 * cue timeline; otherwise rebuild from every 台词/Voiceover field so a stale
 * two-line draft cannot hide newly added middle shots.
 */
export function selectCompleteVoiceoverSource(storyboard: string, currentVoiceover = ''): string {
  const storyboardVoiceover = formatVoiceoverWithTimestamps(storyboard);
  if (!storyboardVoiceover.trim()) return formatVoiceoverWithTimestamps(currentVoiceover);
  if (!hasStoryboardFieldLabels(String(storyboard || '').split(/\n+/))) {
    return formatVoiceoverWithTimestamps(currentVoiceover || storyboard);
  }

  const current = formatVoiceoverWithTimestamps(currentVoiceover);
  if (!current.trim()) return storyboardVoiceover;
  return voiceoverDraftCoversSource(storyboardVoiceover, current) ? current : storyboardVoiceover;
}

export function compactComparable(value: string): string {
  return String(value || '')
    .replace(/[“”"「」『』\s，,。.!！?？;；:：、/\\-]/g, '')
    .toLowerCase();
}

export function stripVoiceoverTimestamps(value: string): string {
  return String(value || '')
    .split(/\n+/)
    .map(line => cleanVoiceoverLine(line))
    .filter(Boolean)
    .join('\n');
}

export function isBadTranslatedLine(text: string, target: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  const hanCount = (normalized.match(/[\u4e00-\u9fff]/g) || []).length;
  const letterCount = (normalized.match(/\p{L}/gu) || []).length;
  if (target !== 'zh' && hanCount >= 6 && hanCount / Math.max(1, letterCount) > 0.45) return true;
  if (/主推品|适合展示|产品替换|参考爆款|参考节奏|我方画面/.test(normalized)) return true;
  return looksLikeProductionInstruction(normalized);
}

export function isNonSpeechSfx(text: string): boolean {
  const normalized = String(text || '')
    .replace(/[\s"'“”‘’.,，。!！?？~～…·:：;；-]/g, '')
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  if (/^(无|暂无|无口播|无台词|无对白|没有口播|没有台词|none|n\/a|no voiceover|no dialogue)$/i.test(normalized)) return true;
  if (/^(噗|噗噗|砰|砰砰|咚|咚咚|哒|哒哒|啪|啪啪|嗒|嗒嗒|咔|咔哒|咔嗒|咔嚓|咯吱|嘎吱|吱呀|叮|叮咚|嘀|滴滴|唰|嗖|嗡|嗡嗡|轰|轰隆|沙沙|刷刷)$/i.test(normalized)) return true;
  if (/^(whoosh|swoosh|pop|popop|bang|boom|ding|beep|click|clack|creak|crack|snap|buzz|whirr|rustle)$/i.test(normalized)) return true;
  if (normalized.length <= 4 && /^([\u54c8\u563f\u5566\u5662\u7830\u549a\u53ee\u6ef4\u54d2\u55d2\u556a\u54d7\u55d2\u5530\u55e1\u5431\u5494\u55d2])\1+$/.test(normalized)) return true;
  return false;
}

export function normalizeTranslatedVoiceover(base: string, translated: string, target: string): string {
  const source = parseTimestampedVoiceover(base).filter(item => !isNonSpeechSfx(item.text));
  const parsed = parseTimestampedVoiceover(translated);
  if (!source.length) {
    const plain = translated.trim();
    return isBadTranslatedLine(plain, target) ? '' : plain;
  }
  const rawCandidates = parsed.length
    ? parsed.map(item => item.text)
    : String(translated || '').split(/\n+/).map(line => cleanVoiceoverLine(line)).filter(Boolean);
  const candidates = rawCandidates
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (candidates.length !== source.length) return '';
  const sourceKeys = source.map(item => compactComparable(item.text));
  const uniqueTranslatedLines = new Set(candidates.map(item => item.toLowerCase()));
  const looksRepeated = candidates.length > 1
    && new Set(sourceKeys).size > 1
    && uniqueTranslatedLines.size === 1;
  const targetSourceOwners = new Map<string, string>();
  const lines: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index]!;
    const candidate = candidates[index] || '';
    const key = candidate.replace(/\s+/g, ' ').trim().toLowerCase();
    const sourceKey = sourceKeys[index] || `cue-${index}`;
    const existingSourceOwner = key ? targetSourceOwners.get(key) : undefined;
    // The same source sentence may legitimately repeat at another timestamp.
    // Reject only when distinct source lines collapse into one target line.
    if (key && !existingSourceOwner) targetSourceOwners.set(key, sourceKey);
    if (looksRepeated || (existingSourceOwner && existingSourceOwner !== sourceKey) || isBadTranslatedLine(candidate, target)) return '';
    lines.push(`${item.time} ${candidate}`);
  }
  return lines.join('\n');
}
