import type { ExecutionContract } from '../digitalEmployees/executionContract.js';
import { hardScriptSafetyIssues } from '../lib/studioScriptQualityV2.js';

export const DIGITAL_EMPLOYEE_DRAFT_POLICY_VERSION = 3;

export type DigitalEmployeeDraftPlatform = 'linkedin' | 'instagram' | 'tiktok' | 'youtube' | 'facebook';

export interface NormalizedDigitalEmployeeDraft {
  platform: DigitalEmployeeDraftPlatform;
  language: string;
  hook: string;
  audience: string;
  cta: string;
  title: string;
  caption: string;
  hashtags: string[];
  voiceover: string[];
  storyboard: Array<{ shot: number; visual: string; voice: string; durationSeconds: number }>;
  evidenceRefs: string[];
  claimBindings: Array<{ claim: string; evidenceRef: string; evidenceQuote: string }>;
}

export interface DigitalEmployeeDraftPolicyResult {
  draft: NormalizedDigitalEmployeeDraft;
  issues: string[];
}

const PLATFORMS = new Set<DigitalEmployeeDraftPlatform>(['linkedin', 'instagram', 'tiktok', 'youtube', 'facebook']);
const AUTOMATED_PUBLISHING_PLATFORMS = new Set<DigitalEmployeeDraftPlatform>(['instagram', 'tiktok', 'youtube', 'facebook']);
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const INVISIBLE_FORMAT_CHARACTERS = /\p{Cf}/gu;

function stringValue(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(CONTROL_CHARACTERS, '').replace(INVISIBLE_FORMAT_CHARACTERS, '').trim()
    : '';
}

function boundedText(value: unknown, field: string, max: number, issues: string[], fallback = ''): string {
  if (typeof value === 'string' && /\p{Cf}/u.test(value)) issues.push(`invisible_format_character:${field}`);
  const result = stringValue(value) || fallback;
  if (result.length > max) issues.push(`field_too_long:${field}:${max}`);
  return result.slice(0, max);
}

function stringList(value: unknown, field: string, maxItems: number, maxItemLength: number, issues: string[]): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    issues.push(`invalid_array:${field}`);
    return [];
  }
  if (value.length > maxItems) issues.push(`too_many_items:${field}:${maxItems}`);
  const output: string[] = [];
  value.slice(0, maxItems).forEach((item, index) => {
    const normalized = boundedText(item, `${field}.${index}`, maxItemLength, issues);
    if (normalized && !output.includes(normalized)) output.push(normalized);
  });
  return output;
}

function lookupKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s/]+/g, ' ');
}

function normalizedFactText(contract: ExecutionContract): string {
  return contract.facts
    .flatMap(fact => [fact.key, fact.source, fact.summary])
    .concat(contract.intent.focusProducts)
    .join('\n')
    .toLowerCase()
    .replace(/[\s,，、/]+/g, ' ');
}

function publicDraftText(draft: NormalizedDigitalEmployeeDraft): string {
  return [
    draft.hook,
    draft.audience,
    draft.cta,
    draft.title,
    draft.caption,
    ...draft.hashtags,
    ...draft.voiceover,
    ...draft.storyboard.flatMap(scene => [scene.visual, scene.voice]),
  ].join('\n');
}

function unsupportedStructuredClaims(content: string, facts: string): string[] {
  const issues: string[] = [];
  const normalizedFacts = facts.toLowerCase().replace(/[\s,，、/]+/g, ' ');
  const unsupported = (pattern: RegExp): string[] => Array.from(content.matchAll(pattern))
    .map(match => match[0].trim())
    .filter(claim => !normalizedFacts.includes(claim.toLowerCase().replace(/[\s,，、/]+/g, ' ')));
  const numericClaims = unsupported(/(?:[$€£¥￥]\s*\d+(?:[.,]\d+)?|(?:usd|eur|gbp|rmb|cny)\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:%|percent|percentage|units?|sets?|pairs?|hours?|hrs?|minutes?|mins?|weeks?|months?|years?|吨|套|双|小时|分钟|周|星期|月|年))/gi);
  if (numericClaims.length) issues.push(`unsupported_numeric_claim:${Array.from(new Set(numericClaims)).join(',')}`);
  const certifications = unsupported(/\b(?:iso\s*\d{3,6}(?::\d{4})?|fda(?:[- ]approved)?|ce(?:[- ]certified)?|ul(?:[- ]listed)?|rohs(?:[- ]compliant)?)\b/gi);
  if (certifications.length) issues.push(`unsupported_certification_claim:${Array.from(new Set(certifications)).join(',')}`);
  const unsupportedTrustClaims = unsupported(/\b(?:patented|award[- ]winning|clinically proven|lab tested|free shipping)\b/gi);
  if (unsupportedTrustClaims.length) issues.push(`unsupported_trust_claim:${Array.from(new Set(unsupportedTrustClaims)).join(',')}`);
  const unsupportedFeatures = unsupported(/\b(?:proprietary(?:[- ][a-z0-9]+){0,4}|aerospace[- ]grade|military[- ]grade|medical[- ]grade|food[- ]grade|industrial[- ]grade|ai[- ](?:powered|enabled|driven|autofocus)|waterproof|fireproof|biodegradable|recyclable|eco[- ]friendly|high[- ]precision|ultra[- ]fast|quantum[- ](?:stabilization|control)|aerospace[- ]grade optics?)\b/gi);
  if (unsupportedFeatures.length) issues.push(`unsupported_feature_claim:${Array.from(new Set(unsupportedFeatures)).join(',')}`);
  const absoluteClaims = Array.from(content.matchAll(/\b(?:guaranteed?|best|fastest|cheapest|always|never|zero defects?|100\s*%|number\s*one)\b|百分之百|百分百|行业第一|全球第一|最好|最便宜|零瑕疵/gi)).map(match => match[0]);
  if (absoluteClaims.length) issues.push(`absolute_claim:${Array.from(new Set(absoluteClaims)).join(',')}`);
  return issues;
}

const SEMANTIC_CLAIM_PATTERNS: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  {
    code: 'unsupported_material_claim',
    pattern: /\b(?:stainless[- ]steel|alumini?um|titanium|carbon[- ]fiber|fiberglass|silicone|polycarbonate|abs plastic|ceramic|tempered glass|alloy|metal body|steel body)\b|不锈钢|铝合金|钛合金|碳纤维|玻璃纤维|硅胶|聚碳酸酯|钢制机身|金属机身/giu,
  },
  {
    code: 'unsupported_connectivity_claim',
    pattern: /\b(?:bluetooth|wi-?fi|wireless|ethernet|usb(?:-c)?|nfc|zigbee|5g|4g|cloud[- ]connected|app[- ]connected|remote connectivity)\b|蓝牙|无线连接|无线通信|以太网|云端连接|远程连接|手机连接/giu,
  },
  {
    code: 'unsupported_durability_claim',
    pattern: /\b(?:durable|rugged|long[- ]lasting|built to last|lasts? for (?:many )?years?|harsh (?:factory|factories|environment|environments|conditions?)|extreme (?:heat|cold|conditions?)|corrosion[- ]resistant|shock[- ]resistant|wear[- ]resistant|weather[- ]resistant|maintenance[- ]free)\b|经久耐用|持久耐用|多年耐用|恶劣环境|恶劣工厂|极端温度|耐腐蚀|耐冲击|耐磨损|免维护/giu,
  },
  {
    code: 'unsupported_performance_claim',
    pattern: /\b(?:precision[- ]engineered|high[- ]performance|advanced (?:optical|vision|control|detection|inspection)? ?system|advanced optics?|accurate|highly accurate|reliable|efficient|powerful|smart detection|real[- ]time detection|faster processing|seamless integration)\b|精密设计|高性能|先进光学|先进系统|精准检测|高精度|高可靠|高效率|实时检测|无缝集成/giu,
  },
  {
    code: 'unsupported_effect_claim',
    pattern: /\b(?:(?:cuts?|reduces?|lowers?|eliminates?|prevents?|boosts?|improves?|increases?|raises?|saves?|optimizes?|accelerates?|maximi[sz]es?|minimi[sz]es?)\s+(?:[a-z][a-z-]*\s+){0,4}(?:downtime|costs?|waste|errors?|defects?|labor|time|energy|output|throughput|quality|efficiency|productivity|yield|risk)|delivers? (?:better|higher|faster|consistent)|ensures? (?:quality|accuracy|reliability|consistency)|suitable for|ideal for|designed for|works? (?:in|with|under))\b|减少停机|降低成本|减少浪费|降低错误|减少缺陷|提升产量|提高效率|提高生产力|节省时间|节省人工|优化生产|确保质量|保证精度|适用于|专为.+设计/giu,
  },
];

function semanticClaimMatches(content: string): Array<{ code: string; claim: string }> {
  return SEMANTIC_CLAIM_PATTERNS.flatMap(({ code, pattern }) => Array.from(content.matchAll(pattern), match => ({
    code,
    claim: match[0].trim(),
  })));
}

const NEUTRAL_AUTOMATION_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'from', 'by', 'as', 'at', 'about',
  'this', 'these', 'your', 'our', 'is', 'are', 'be', 'before', 'after', 'today',
  'review', 'see', 'show', 'request', 'contact', 'learn', 'explore', 'view', 'discover', 'read', 'ask', 'compare',
  'consider', 'choose', 'choosing', 'documented', 'verified', 'facts', 'fact', 'specification', 'specifications', 'sheet',
  'details', 'detail', 'information', 'product', 'products', 'supplier', 'suppliers', 'option', 'options',
  'image', 'images', 'video', 'demo', 'demonstration', 'overview', 'introduction', 'provided', 'supplied',
  'camera', 'frame', 'shot', 'display', 'focus', 'background', 'scene', 'transition', 'voice', 'caption', 'text',
  'close', 'up', 'open', 'full', 'next', 'step', 'team', 'teams', 'available',
]);
const NEUTRAL_CJK_PHRASES = [
  '请', '查看', '查阅', '了解', '展示', '阅读', '获取', '联系', '咨询', '比较', '考虑', '选择',
  '已记录', '已验证', '经验证', '事实', '规格', '规格表', '资料', '详情', '信息', '产品', '供应商',
  '图片', '视频', '演示', '概览', '介绍', '提供的', '所提供', '镜头', '画面', '字幕', '口播',
  '特写', '全景', '下一步', '团队', '以及', '并且', '之前', '之后', '关于',
];

function replaceLiteral(value: string, literal: string): string {
  if (!literal.trim()) return value;
  return value.replace(new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), ' ');
}

function replaceLiteralWith(value: string, literal: string, replacement: string): string {
  if (!literal.trim()) return value;
  return value.replace(new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), replacement);
}

function unsupportedLexicalClaims(input: {
  content: string;
  contract: ExecutionContract;
  bindings: NormalizedDigitalEmployeeDraft['claimBindings'];
}): string[] {
  let residual = input.content.normalize('NFKC').replace(INVISIBLE_FORMAT_CHARACTERS, '').toLowerCase();
  // Only exact product names, the exact audience, and exact extractive claims
  // are allowed to carry business meaning. Everything else must come from a
  // deliberately small neutral presentation vocabulary.
  for (const literal of [
    ...input.bindings.map(binding => binding.claim),
    ...input.contract.intent.focusProducts,
    input.contract.intent.audience,
    input.contract.intent.market,
  ].filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))) {
    residual = replaceLiteral(residual, literal.normalize('NFKC').toLowerCase());
  }
  // Hashtags may concatenate a verified product name (for example
  // "Vision Sensor" -> "#VisionSensor").
  for (const product of input.contract.intent.focusProducts) {
    residual = replaceLiteral(residual, product.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s_]+/gu, ''));
  }
  for (const phrase of NEUTRAL_CJK_PHRASES) residual = replaceLiteral(residual, phrase);
  const unsupported = Array.from(residual.matchAll(/[\p{L}\p{N}]+/gu), match => match[0])
    .filter(token => {
      if (/^[a-z]+$/i.test(token)) return token.length > 2 && !NEUTRAL_AUTOMATION_WORDS.has(token);
      // Bound numeric facts were removed above. Any remaining number or
      // non-Latin lexical content is unverified by construction.
      return true;
    });
  return Array.from(new Set(unsupported)).slice(0, 30).map(token => `unsupported_lexical_claim:${token}`);
}

function templateCoverageIssues(input: {
  draft: Omit<NormalizedDigitalEmployeeDraft, 'claimBindings'>;
  contract: ExecutionContract;
  bindings: NormalizedDigitalEmployeeDraft['claimBindings'];
}): string[] {
  const prepare = (raw: string): string => {
    let value = raw.normalize('NFKC').replace(INVISIBLE_FORMAT_CHARACTERS, '').toLowerCase();
    for (const binding of [...input.bindings].sort((a, b) => b.claim.length - a.claim.length)) {
      value = replaceLiteralWith(value, binding.claim.normalize('NFKC').toLowerCase(), ' evidencefacttoken ');
    }
    for (const product of [...input.contract.intent.focusProducts].sort((a, b) => b.length - a.length)) {
      value = replaceLiteralWith(value, product.normalize('NFKC').toLowerCase(), ' productnametoken ');
      value = replaceLiteralWith(value, product.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''), ' productnametoken ');
    }
    value = replaceLiteralWith(value, String(input.contract.intent.audience || '').normalize('NFKC').toLowerCase(), ' audiencetoken ');
    value = value.replace(/[\p{P}\p{S}_]+/gu, ' ').replace(/\s+/g, ' ').trim();
    return value;
  };
  const allowed = (value: string): boolean => [
    /^audiencetoken$/,
    /^productnametoken$/,
    /^evidencefacttoken$/,
    /^productnametoken overview$/,
    /^review (?:the )?productnametoken facts$/,
    /^review the documented facts evidencefacttoken$/,
    /^review the documented productnametoken facts before choosing a supplier$/,
    /^review the documented product facts before choosing a supplier$/,
    /^request the verified specification sheet$/,
    /^show the supplied product image$/,
    /^review the documented facts evidencefacttoken request the verified specification sheet$/,
  ].some(pattern => pattern.test(prepare(value)));
  const fields: Array<[string, string]> = [
    ['hook', input.draft.hook], ['audience', input.draft.audience], ['cta', input.draft.cta],
    ['title', input.draft.title], ['caption', input.draft.caption],
    ...input.draft.hashtags.map((value, index) => [`hashtags.${index}`, value] as [string, string]),
    ...input.draft.voiceover.map((value, index) => [`voiceover.${index}`, value] as [string, string]),
    ...input.draft.storyboard.flatMap((scene, index) => [
      [`storyboard.${index}.visual`, scene.visual] as [string, string],
      [`storyboard.${index}.voice`, scene.voice] as [string, string],
    ]),
  ];
  return fields.filter(([, value]) => value && !allowed(value)).map(([field]) => `non_template_public_copy:${field}`);
}

function prohibitedPhrases(value: string): string[] {
  return value.split(/[\n,，、;；]+/)
    .map(item => item.trim().replace(/^(?:禁止|不得|不要|避免|禁用|切勿|do\s+not|don't|must\s+not|avoid)\s*[:：-]?\s*/i, '').replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''))
    .filter(item => item.length >= 2 && item.length <= 80);
}

function phraseIssues(content: string, phrases: string[], code: string): string[] {
  const confusableSkeleton = (value: string) => value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}+/gu, '')
    .replace(/[013457@$]/g, character => ({
      '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's',
    })[character] || character)
    .replace(/[аеорсхуіјкмтвнαβε ικορτυχ]/gu, character => ({
      'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i', 'ј': 'j',
      'к': 'k', 'м': 'm', 'т': 't', 'в': 'b', 'н': 'h', 'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'i',
      'κ': 'k', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'y', 'χ': 'x',
    })[character] || character);
  const canonical = (value: string) => confusableSkeleton(value).replace(/[\p{Cf}\p{P}\p{S}\s_]+/gu, '');
  const normalizedContent = canonical(content);
  return Array.from(new Set(phrases))
    .filter(phrase => canonical(phrase).length >= 2 && normalizedContent.includes(canonical(phrase)))
    .map(phrase => `${code}:${phrase}`);
}

export function evaluateDigitalEmployeeDraftPolicy(input: {
  generated: Record<string, unknown>;
  contract: ExecutionContract;
  brandTaboos?: string;
}): DigitalEmployeeDraftPolicyResult {
  const issues: string[] = [];
  const platformValue = stringValue(input.generated.platform).toLowerCase();
  if (!PLATFORMS.has(platformValue as DigitalEmployeeDraftPlatform)) issues.push('invalid_platform');
  const platform = PLATFORMS.has(platformValue as DigitalEmployeeDraftPlatform)
    ? platformValue as DigitalEmployeeDraftPlatform
    : 'linkedin';
  const connectedPublishingPlatforms = new Set(
    (input.contract.resources?.connectedAccounts || [])
      .map(account => stringValue(account.platform).toLowerCase())
      .filter(value => AUTOMATED_PUBLISHING_PLATFORMS.has(value as DigitalEmployeeDraftPlatform)),
  );
  if (connectedPublishingPlatforms.size && !connectedPublishingPlatforms.has(platform)) {
    issues.push(`platform_not_connected:${platform}`);
  }
  const language = boundedText(input.generated.language, 'language', 16, issues, 'en');
  if (!/^[a-z]{2,3}(?:-[a-z]{2,4})?$/i.test(language)) issues.push('invalid_language');

  const hook = boundedText(input.generated.hook, 'hook', 300, issues);
  const audience = boundedText(input.generated.audience, 'audience', 300, issues, input.contract.intent.audience);
  if (lookupKey(audience) !== lookupKey(input.contract.intent.audience)) issues.push('audience_not_contract_bound');
  const cta = boundedText(input.generated.cta, 'cta', 300, issues);
  const title = boundedText(input.generated.title, 'title', 300, issues);
  const caption = boundedText(input.generated.caption, 'caption', 5_000, issues);
  for (const [field, value] of Object.entries({ hook, audience, cta, title, caption })) {
    if (!value) issues.push(`required_field_missing:${field}`);
  }

  const hashtags = stringList(input.generated.hashtags, 'hashtags', 20, 80, issues);
  const voiceover = stringList(input.generated.voiceover, 'voiceover', 10, 1_000, issues);
  const storyboard: NormalizedDigitalEmployeeDraft['storyboard'] = [];
  if (input.generated.storyboard != null && !Array.isArray(input.generated.storyboard)) {
    issues.push('invalid_array:storyboard');
  } else {
    const scenes = Array.isArray(input.generated.storyboard) ? input.generated.storyboard : [];
    if (scenes.length > 10) issues.push('too_many_items:storyboard:10');
    scenes.slice(0, 10).forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        issues.push(`invalid_storyboard_scene:${index}`);
        return;
      }
      const scene = item as Record<string, unknown>;
      const visual = boundedText(scene.visual, `storyboard.${index}.visual`, 1_000, issues);
      const voice = boundedText(scene.voice, `storyboard.${index}.voice`, 1_000, issues);
      const duration = Number(scene.durationSeconds);
      if (!Number.isFinite(duration) || duration < 1.5 || duration > 8) issues.push(`invalid_storyboard_duration:${index}`);
      storyboard.push({
        shot: index + 1,
        visual,
        voice,
        durationSeconds: Number.isFinite(duration) ? Math.max(1.5, Math.min(8, Number(duration.toFixed(2)))) : 3,
      });
    });
  }
  const spokenCharacters = (storyboard.some(scene => scene.voice) ? storyboard.map(scene => scene.voice) : voiceover).join('\n').length;
  if (!spokenCharacters) issues.push('voice_content_missing');
  if (spokenCharacters > 5_000) issues.push('voice_content_too_long:5000');
  if (storyboard.reduce((total, scene) => total + scene.durationSeconds, 0) > 60) issues.push('storyboard_duration_too_long:60');

  const rawEvidenceRefs = stringList(input.generated.evidenceRefs, 'evidenceRefs', 20, 200, issues);
  const factLookup = new Map<string, { key: string; summary: string }>();
  input.contract.facts.forEach(fact => {
    factLookup.set(lookupKey(fact.key), { key: fact.key, summary: fact.summary });
    factLookup.set(lookupKey(fact.source), { key: fact.key, summary: fact.summary });
  });
  const evidenceRefs: string[] = [];
  rawEvidenceRefs.forEach(ref => {
    const canonical = factLookup.get(lookupKey(ref));
    if (!canonical) issues.push(`unsupported_evidence_ref:${ref}`);
    else if (!evidenceRefs.includes(canonical.key)) evidenceRefs.push(canonical.key);
  });
  if (!evidenceRefs.length) issues.push('evidence_refs_missing');
  if (input.contract.facts.some(fact => fact.key === 'products') && !evidenceRefs.includes('products')) {
    issues.push('products_evidence_missing');
  }

  const draftWithoutBindings = {
    platform,
    language: language.toLowerCase(),
    hook,
    audience,
    cta,
    title,
    caption,
    hashtags,
    voiceover,
    storyboard,
    evidenceRefs,
  };
  const content = publicDraftText({ ...draftWithoutBindings, claimBindings: [] });
  const rawBindings = Array.isArray(input.generated.claimBindings) ? input.generated.claimBindings : [];
  if (!Array.isArray(input.generated.claimBindings)) issues.push('invalid_array:claimBindings');
  if (rawBindings.length > 50) issues.push('too_many_items:claimBindings:50');
  const claimBindings: NormalizedDigitalEmployeeDraft['claimBindings'] = [];
  const canonicalText = (value: string) => value.normalize('NFKC').toLowerCase()
    .replace(/[\p{Cf}\p{P}\p{S}\s_]+/gu, '');
  rawBindings.slice(0, 50).forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push(`invalid_claim_binding:${index}`);
      return;
    }
    const raw = item as Record<string, unknown>;
    const claim = boundedText(raw.claim, `claimBindings.${index}.claim`, 1_000, issues);
    const refValue = boundedText(raw.evidenceRef, `claimBindings.${index}.evidenceRef`, 200, issues);
    const evidenceQuote = boundedText(raw.evidenceQuote, `claimBindings.${index}.evidenceQuote`, 1_000, issues);
    const fact = factLookup.get(lookupKey(refValue));
    if (!claim || !evidenceQuote || !fact) {
      issues.push(`invalid_claim_binding:${index}`);
      return;
    }
    const normalizedClaim = canonicalText(claim);
    const normalizedQuote = canonicalText(evidenceQuote);
    const normalizedSummary = canonicalText(fact.summary);
    if (normalizedClaim.length < 2 || !canonicalText(content).includes(normalizedClaim)) {
      issues.push(`claim_not_in_draft:${index}`);
    }
    // Public claims are bound to the complete fact summary, not an arbitrary
    // substring. Substrings can silently invert meaning (for example taking
    // "available" out of "unavailable" or dropping "not"). Exact binding is
    // intentionally conservative: autonomous publishing must preserve the
    // evidence sentence and all of its qualifiers verbatim.
    if (normalizedQuote.length < 2 || normalizedQuote !== normalizedSummary) {
      issues.push(`evidence_quote_not_complete_fact:${index}`);
    }
    if (normalizedClaim !== normalizedQuote) issues.push(`claim_not_complete_fact:${index}`);
    claimBindings.push({ claim, evidenceRef: fact.key, evidenceQuote });
  });
  if (!claimBindings.length) issues.push('claim_bindings_missing');
  const draft: NormalizedDigitalEmployeeDraft = { ...draftWithoutBindings, claimBindings };
  const facts = normalizedFactText(input.contract);
  issues.push(...hardScriptSafetyIssues(content, facts));
  issues.push(...unsupportedStructuredClaims(content, facts));
  for (const match of semanticClaimMatches(content)) {
    const normalized = canonicalText(match.claim);
    const supported = claimBindings.some(binding => canonicalText(binding.claim).includes(normalized)
      && canonicalText(binding.evidenceQuote).includes(normalized));
    if (!supported) issues.push(`${match.code}:${match.claim}`);
  }
  issues.push(...unsupportedLexicalClaims({ content, contract: input.contract, bindings: claimBindings }));
  issues.push(...templateCoverageIssues({ draft: draftWithoutBindings, contract: input.contract, bindings: claimBindings }));
  issues.push(...phraseIssues(content, prohibitedPhrases(input.brandTaboos || ''), 'brand_taboo_used'));
  issues.push(...phraseIssues(content, input.contract.policy.constraints.flatMap(prohibitedPhrases), 'policy_constraint_violation'));
  return { draft, issues: Array.from(new Set(issues)) };
}

export function enforceDigitalEmployeeDraftPolicy(input: {
  generated: Record<string, unknown>;
  contract: ExecutionContract;
  brandTaboos?: string;
}): NormalizedDigitalEmployeeDraft {
  const result = evaluateDigitalEmployeeDraftPolicy(input);
  if (result.issues.length) {
    throw new Error(`content_draft_quality_gate_failed:${result.issues.join('|').slice(0, 1_500)}`);
  }
  return result.draft;
}

/**
 * Deterministic last-resort copy for autonomous runs. It uses only neutral
 * presentation language plus an exact excerpt from the product fact. This is
 * intentionally less creative than the model draft, but remains usable and
 * cannot turn a quality retry into an ungrounded external claim.
 */
export function buildEvidenceBoundFallbackDraft(contract: ExecutionContract): Record<string, unknown> {
  const productFact = contract.facts.find(fact => fact.key === 'products');
  if (!productFact?.summary.trim() || !contract.intent.focusProducts[0]) {
    throw new Error('evidence_bound_fallback_unavailable');
  }
  const product = contract.intent.focusProducts[0].trim();
  const claim = productFact.summary.trim();
  const platform = (contract.resources.connectedAccounts || [])
    .map(account => stringValue(account.platform).toLowerCase())
    .find(value => AUTOMATED_PUBLISHING_PLATFORMS.has(value as DigitalEmployeeDraftPlatform)) || 'linkedin';
  const voice = `Review the documented facts: ${claim}. Request the verified specification sheet.`;
  return {
    platform,
    language: 'en',
    hook: `Review the ${product} facts.`,
    audience: contract.intent.audience,
    cta: 'Request the verified specification sheet.',
    title: `${product} overview`,
    caption: `Review the documented facts: ${claim}.`,
    hashtags: [`#${product.replace(/[^\p{L}\p{N}]+/gu, '')}`],
    voiceover: [voice],
    storyboard: [{ shot: 1, visual: 'Show the supplied product image.', voice, durationSeconds: 6 }],
    evidenceRefs: ['products'],
    claimBindings: [{ claim, evidenceRef: 'products', evidenceQuote: claim }],
  };
}
