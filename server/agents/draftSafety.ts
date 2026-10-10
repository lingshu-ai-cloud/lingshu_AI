const FACTUAL_RISK_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: 'commercial terms or commitment',
    pattern: /\b(?:price|quote|quotation|discount|stock|in stock|available|availability|moq|minimum order|lead time|delivery|ship(?:ping)?|payment|deposit|certif(?:ied|icate|ication)|warranty|guarantee|promise|capacity|factory|manufacturer)\b/i,
  },
  {
    label: 'product or company factual claim',
    pattern: /\b(?:we|our)\s+(?:are|have|come|support|use|include|ship|deliver|meet|provide|offer|accept|produce|manufacture)\b|\b(?:this|it|the (?:product|item|model))\s+(?:is|has|can|comes?|supports?|uses?|includes?|ships?|delivers?|meets?|provides?|offers?|works?|lasts?|fits?|accepts?)\b/i,
  },
  {
    label: 'company capability commitment',
    pattern: /\bwe\s+can\s+(?:supply|produce|manufacture|customi[sz]e|deliver|ship|offer|provide|support|meet|accept|certify|guarantee)\b/i,
  },
  {
    label: 'product attribute claim',
    pattern: /\b(?:made (?:of|from|with)|material\s*(?:is|:)|comes? in|available in|dimensions?\s*(?:are|is|:)|sizes?\s*(?:are|is|:)|colou?rs?\s*(?:are|is|:)|weights?\s*(?:are|is|:)|capacity\s*(?:is|:)|voltage\s*(?:is|:)|ingredients?\s*(?:are|is|:)|certified|waterproof|food[- ]grade)\b/i,
  },
  {
    label: 'order or logistics status claim',
    pattern: /\b(?:has shipped|have shipped|was shipped|dispatched|in transit|on the way|tracking number|order status|invoice (?:is|has|was)|payment (?:is|has|was))\b/i,
  },
  {
    label: 'claimed conversation memory',
    pattern: /\b(?:you|your (?:team|company))\s+(?:said|mentioned|asked|needed|wanted|preferred|confirmed|were looking|had chosen|agreed)\b/i,
  },
  {
    label: 'Spanish business fact or commitment',
    pattern: /\b(?:precio|cotizaci[oó]n|descuento|stock|disponible|disponibilidad|pedido m[ií]nimo|entrega|env[ií]o|pago|dep[oó]sito|certificad[oa]|garant[ií]a|plazo|f[aá]brica|material|podemos entregar|podemos enviar)\b/i,
  },
  {
    label: 'Arabic business fact or commitment',
    pattern: /(?:سعر|عرض سعر|خصم|مخزون|متوفر|الحد الأدنى|شحن|تسليم|دفع|عربون|شهادة|ضمان|مدة التوريد|مصنع|مادة|يمكننا الشحن|يمكننا التسليم)/i,
  },
];

export function unsupportedDraftNumbers(draft: string, factualSource: string): string[] {
  const values = draft.match(/\b\d+(?:[.,]\d+)?\b/g) ?? [];
  const evidenceValues = new Set(factualSource.match(/\b\d+(?:[.,]\d+)?\b/g) ?? []);
  return Array.from(new Set(values.filter(value => !evidenceValues.has(value))));
}

export function draftFactualRiskSignals(draft: string, factualSource: string): string[] {
  const signals = FACTUAL_RISK_PATTERNS
    .filter(item => item.pattern.test(draft))
    .map(item => item.label);
  if (unsupportedDraftNumbers(draft, factualSource).length) signals.push('number absent from supplied evidence');
  return Array.from(new Set(signals));
}

export function requiresFactualVerification(signals: string[], knowledgeMiss: boolean): boolean {
  return knowledgeMiss || signals.length > 0;
}

const HIGH_RISK_SUPPORT_RULES: Array<{ label: string; draft: RegExp; evidence: RegExp }> = [
  {
    label: 'private-label capability is not grounded',
    draft: /\b(?:we|our (?:team|factory|company))\s+(?:can|support|offer|provide|do|handle)[^.!?]{0,80}\b(?:private[ -]?label|oem|odm)\b/i,
    evidence: /\b(?:private[ -]?label|oem|odm)\b|贴牌|代工/i,
  },
  {
    label: 'bilingual or Arabic packaging capability is not grounded',
    draft: /\b(?:we|our (?:team|factory|company))\s+(?:can|support|offer|provide|do|handle)[^.!?]{0,100}\b(?:arabic|bilingual|english[- +]arabic)\b[^.!?]{0,40}\b(?:packaging|label)\b/i,
    evidence: /\b(?:arabic|bilingual|english[- +]arabic)\b[^.!?]{0,80}\b(?:packaging|label)\b|阿拉伯语包装|双语包装/i,
  },
  {
    label: 'certification validity claim is not grounded',
    draft: /\b(?:accredited bod(?:y|ies)|all certifications? (?:are|is)|certifications? (?:are|is) live|match(?:es)? our production|internationally recognized quality standard|made under international)\b/i,
    evidence: /\b(?:accredited bod(?:y|ies)|certifications? (?:are|is) live|internationally recognized|gmp|iso)\b|认可机构|国际认证/i,
  },
  {
    label: 'free inspection promise is not grounded',
    draft: /\b(?:third[- ]party inspection|inspection)[^.!?]{0,60}\b(?:free|no extra charge|without extra charge)\b|\b(?:free|no extra charge)[^.!?]{0,60}\binspection\b/i,
    evidence: /\b(?:third[- ]party inspection|inspection)[^.!?]{0,60}\b(?:free|no extra charge|without extra charge)\b|免费验货/i,
  },
  {
    label: 'company identity claim is not grounded',
    draft: /\bwe(?:['’]re| are) (?:a )?(?:factory|manufacturer|trading company|factory \+ trading company)\b/i,
    evidence: /\b(?:factory|manufacturer|trading company|factory \+ trading company)\b|企业类型：.*(?:工厂|制造商|贸易)/i,
  },
  {
    label: 'deadline promise is not grounded',
    draft: /\b(?:i|we)(?:['’]ll| will)\s+[^.!?]{0,100}\b(?:by end of day|today|within \d+ (?:hours?|days?)|in \d+ days?)\b/i,
    evidence: /\b(?:by end of day|within \d+ (?:hours?|days?)|in \d+ days?)\b|当天回复|\d+天内/i,
  },
];

const CERTIFICATION_NAMES = /\b(?:CE|FCC|RoHS|REACH|UL|GMP|ISO(?:[ -]?\d{4,5}(?::\d{4})?)?)\b/gi;
const CERTIFICATION_UNCONFIRMED = /\b(?:not|no|without|lack|lacks|pending|unconfirmed|unknown(?![-_])|unverified|expired|revoked|whether|if|check|verify|confirm|checking|verifying|confirming|need|needs|require|requires|requested|request|seeking|may|might|could)\b|\b(?:isn|aren|wasn|weren|don|doesn|haven|hasn|can|won)['’]t\b|尚未|未获|没有|无认证|不具备|待核|待确认|需核|是否|过期|撤销/i;
const CERTIFICATION_AFFIRMED = /\b(?:certified|approved|compliant|accredited|hold|holds|have|has|available|ready|valid|obtained|passed|meet|meets|carry|carries)\b|已获|通过|具备|持有|符合|认证齐全|认证(?:有效|可用)|可提供[^。！？]{0,30}(?:认证|证书)/i;

function certificationClauses(text: string): string[] {
  return text.split(/(?<=[.!?。！？;；,，])|\n|\band\b(?=\s+(?:no|not|please|we|you|the|our|samples)\b)|\bbut\b|但是|但(?=已|有|通过)/i).map(value => value.trim()).filter(Boolean);
}

function certificationNames(text: string): string[] {
  return Array.from(text.matchAll(CERTIFICATION_NAMES), match => match[0].toUpperCase().replace(/[ -]/g, ''));
}

// The caller supplies only company knowledge, never customer requests or seller history.
function certificationEvidence(source: string, draft: string): Set<string> {
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { parsed = source; }
  const namedSkus = new Set<string>();
  const availableSkus = new Set<string>();
  const explicitSkuReferences = new Set([
    ...Array.from(draft.matchAll(/\b[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g), match => match[0].toLowerCase()),
    ...Array.from(draft.matchAll(/\bSKU\s*[:=]?\s*([A-Z0-9_-]+)/g), match => match[1].toLowerCase()),
  ]);
  const collectSkus = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(collectSkus);
    else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.sku === 'string') {
        availableSkus.add(record.sku.toLowerCase());
        if (draft.toLowerCase().includes(record.sku.toLowerCase())) namedSkus.add(record.sku.toLowerCase());
      }
      Object.values(record).forEach(collectSkus);
    }
  };
  collectSkus(parsed);
  const supported = new Set<string>();
  const denied = new Set<string>();
  const visit = (value: unknown, field = ''): void => {
    if (typeof value === 'string') {
      for (const clause of certificationClauses(value)) {
        const names = certificationNames(clause);
        if (CERTIFICATION_UNCONFIRMED.test(clause)) names.forEach(name => denied.add(name));
        else if (CERTIFICATION_AFFIRMED.test(clause) || /certif|认证|证书/i.test(field)) {
          names.forEach(name => supported.add(name));
        }
      }
    } else if (Array.isArray(value)) value.forEach(item => visit(item, field));
    else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.sku === 'string' && ((namedSkus.size && !namedSkus.has(record.sku.toLowerCase())) || (!namedSkus.size && (availableSkus.size > 1 || explicitSkuReferences.size > 0)))) return;
      Object.entries(record).forEach(([key, item]) => visit(item, key));
    }
  };
  visit(parsed);
  // Contradictory enterprise records need manual verification rather than an affirmative claim.
  denied.forEach(name => supported.delete(name));
  return supported;
}

function unsupportedCertificationClaims(draft: string, source: string): string[] {
  const supported = certificationEvidence(source, draft);
  const unsupported = new Set<string>();
  for (const clause of certificationClauses(draft)) {
    if (CERTIFICATION_UNCONFIRMED.test(clause) || /\?$/.test(clause)) continue;
    if (!CERTIFICATION_AFFIRMED.test(clause)) continue;
    for (const name of certificationNames(clause)) {
      if (!supported.has(name)) unsupported.add(`${name} certification availability is not grounded`);
    }
  }
  return [...unsupported];
}

const QUALITY_DOCUMENT = /\b(?:certificates?|certifications?|coa|lab reports?|test reports?|compliance documents?|inspection reports?|gmp|iso(?:[ -]?\d{4,5})?)\b/i;
const QUALITY_DOCUMENT_PROMISE = /\b(?:(?:we|i)(?:['’]ll|\s+(?:can|will|are able to))|let\s+me)\s+(?:send|share|provide|forward|arrange|pull(?: up)?|get(?!\s+back\b)|retrieve|attach|download)[^.!?]{0,100}\b(?:certificates?|certifications?|coa|lab reports?|test reports?|compliance documents?|inspection|gmp|iso)\b/i;

function hasDocumentExistenceEvidence(source: string, draft: string): boolean {
  const requiredCertifications = certificationNames(draft);
  const documentTypes = [/\bcertificat(?:e|es|ion|ions)\b/i, /\bcoa\b/i, /\blab reports?\b/i, /\btest reports?\b/i, /\bcompliance documents?\b/i, /\binspection(?: reports?)?\b/i];
  const requiredDocumentTypes = documentTypes.filter(pattern => pattern.test(draft));
  const explicitSkus = Array.from(draft.matchAll(/\b[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g), match => match[0].toLowerCase());
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { parsed = source; }
  let supported = false;
  let denied = false;
  const visit = (value: unknown, field = ''): void => {
    if (typeof value === 'string') {
      for (const clause of certificationClauses(value)) {
        if (!QUALITY_DOCUMENT.test(clause) && !/certificate|certification|document|证书|报告/i.test(field)) continue;
        if (CERTIFICATION_UNCONFIRMED.test(clause) || /isn['’]t|aren['’]t|doesn['’]t|don['’]t/i.test(clause)) denied = true;
        else if (/\b(?:on file|in our files|available|attached|have|has|hold|holds|stored|downloadable)\b|已有|持有|已上传|可下载|文件齐全/i.test(clause)
          || (/certificate|document|证书|报告/i.test(field) && /https?:\/\/|\.(?:pdf|docx?)(?:$|[?#])/i.test(clause))) {
          const names = certificationNames(clause);
          if ((!requiredCertifications.length || requiredCertifications.every(name => names.includes(name)))
            && requiredDocumentTypes.every(pattern => pattern.test(`${field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ')} ${clause}`))) supported = true;
        }
      }
    } else if (Array.isArray(value)) value.forEach(item => visit(item, field));
    else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (explicitSkus.length && typeof record.sku === 'string' && !explicitSkus.includes(record.sku.toLowerCase())) return;
      Object.entries(record).forEach(([key, item]) => visit(item, key));
    }
  };
  visit(parsed);
  return supported && !denied;
}

function unsupportedQualityDocumentPromise(draft: string, source: string): string[] {
  const promised = certificationClauses(draft).some(clause => QUALITY_DOCUMENT_PROMISE.test(clause)
    && !/\b(?:if|whether|may|might|could)\b|是否|待核实/i.test(clause));
  return promised && !hasDocumentExistenceEvidence(source, draft) ? ['quality document promise is not grounded'] : [];
}

export function unsupportedHighRiskClaims(draft: string, factualSource: string): string[] {
  return [...unsupportedCertificationClaims(draft, factualSource), ...unsupportedQualityDocumentPromise(draft, factualSource), ...HIGH_RISK_SUPPORT_RULES
    .filter(rule => rule.draft.test(draft) && !rule.evidence.test(factualSource))
    .map(rule => rule.label)];
}

export function hasInternalPromptLeak(draft: string): boolean {
  return /\b(?:system prompt|intent instruction|conversation phase|knowledgeReady|knowledge miss is true|customer id|recent timeline|detected factual-risk signals|return one directly-sendable reply|unified knowledge context|dialogue strategies)\b|统一知识检索上下文|硬规则：|客户上下文：/i.test(draft);
}
