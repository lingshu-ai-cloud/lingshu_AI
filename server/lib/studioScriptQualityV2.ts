export type StudioScriptQualityStatus = 'passed' | 'warning' | 'needs_material' | 'rejected';

export type StudioScriptMaterialInfo = {
  name?: string;
  targetStart?: number;
  targetEnd?: number;
  observations?: string[];
};

export type MaterialCoverage = {
  selectedMaterials: number;
  storyboardScenes: number;
  boundScenes: number;
  pendingScenes: number;
  coverageRatio: number;
};

export type StudioScriptQualityV2Result = {
  script: string;
  qualityStatus: StudioScriptQualityStatus;
  hardIssues: string[];
  warnings: string[];
  materialCoverage: MaterialCoverage;
};

const MATERIAL_VISUAL_FACT_GROUPS: string[][] = [
  ['展会', '展馆', '展台', '观众', 'imtex', 'exhibition', 'trade show'],
  ['展板', '标识', 'logo', 'brand mark'],
  ['屏幕', '界面', '检测结果', '识别结果', 'dashboard', 'interface', 'inspection result'],
  ['正在运行', '实时运行', '运转中', 'running live', 'in operation'],
  ['划伤', '字符识别', 'scratch detection', 'ocr'],
];

const BUSINESS_ROLE_TERMS = [
  'factory automation manager', 'automation manager', 'automation lead',
  'engineering manager', 'plant manager', 'factory manager', 'project buyer',
  'equipment manager', 'production manager', 'process manager', 'process engineer',
  'quality manager', 'qa manager', 'procurement manager', 'procurement', 'buyer',
  'sourcing manager', 'supply chain manager', 'system integrator',
  'brand founder', 'brand owner', 'product manager', 'channel buyer',
  'importer', 'distributor',
];

function normalized(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[\s,，、/]+/g, ' ');
}

function evidenceSupportsTerm(evidence: string, term: string): boolean {
  const source = evidence.toLowerCase();
  const needle = term.toLowerCase();
  let cursor = source.indexOf(needle);
  while (cursor >= 0) {
    const prefix = source.slice(Math.max(0, cursor - 24), cursor);
    if (!/(?:未(?:观察到|发现|显示|出现)|没有|不存在|不含|无|not\s+(?:observed|visible|shown|present)|without|no)\s*[^，。;；\n]{0,12}$/i.test(prefix)) return true;
    cursor = source.indexOf(needle, cursor + needle.length);
  }
  return false;
}

export function storyboardSceneRanges(script: string): Array<{ start: number; end: number }> {
  return Array.from(String(script || '').matchAll(/^\s*\[\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\]/gm))
    .map(match => ({ start: Number(match[1]), end: Number(match[2]) }))
    .filter(range => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start);
}

export function materialCoverageForScript(
  script: string,
  materialInfos: StudioScriptMaterialInfo[],
): MaterialCoverage {
  const storyboardScenes = storyboardSceneRanges(script).length;
  const selectedMaterials = materialInfos.length;
  const availableSceneSlots = materialInfos.reduce((total, info) => (
    total + Math.max(1, info.observations?.filter(Boolean).length || 0)
  ), 0);
  const explicitlyPending = (String(script || '').match(/^\s*素材[：:]\s*待匹配素材\s*$/gm) || []).length;
  const pendingScenes = Math.min(storyboardScenes, Math.max(
    explicitlyPending,
    Math.max(0, storyboardScenes - availableSceneSlots),
  ));
  const boundScenes = Math.max(0, storyboardScenes - pendingScenes);
  return {
    selectedMaterials,
    storyboardScenes,
    boundScenes,
    pendingScenes,
    coverageRatio: storyboardScenes > 0 ? Number((boundScenes / storyboardScenes).toFixed(2)) : 0,
  };
}

export function markUncoveredMaterialScenes(script: string, materialInfos: StudioScriptMaterialInfo[]): string {
  const availableSceneSlots = materialInfos.reduce((total, info) => (
    total + Math.max(1, info.observations?.filter(Boolean).length || 0)
  ), 0);
  let sceneIndex = 0;
  return String(script || '').split(/(?=^[ \t]*\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\][ \t]*$)/m).map(block => {
    if (!/^\s*\[\s*\d/.test(block)) return block;
    const covered = sceneIndex < availableSceneSlots;
    sceneIndex += 1;
    if (covered) return block;
    let next = block;
    const replaceField = (field: string, value: string) => {
      const pattern = new RegExp(`^[ \\t]*${field}[：:].*$`, 'm');
      if (pattern.test(next)) next = next.replace(pattern, `${field}：${value}`);
      else next = `${next.replace(/\s+$/, '')}\n${field}：${value}\n`;
    };
    replaceField('素材', '待匹配素材');
    replaceField('环境', '按后续补充素材的实际环境');
    replaceField('构图', '仅使用后续补充素材中的实际可见内容');
    replaceField('镜头功能', '待补素材');
    replaceField('画面', '待匹配素材；需补充能够证明本段信息的实际画面');
    return next;
  }).join('');
}

export function isBusinessRoleEntity(entity: string, targetBuyerText = ''): boolean {
  const value = normalized(entity);
  if (!value) return false;
  if (BUSINESS_ROLE_TERMS.some(role => value === role || value.includes(role))) return true;
  const audience = normalized(targetBuyerText);
  if (audience && (audience.includes(value) || value.split(' ').every(part => audience.includes(part)))) return true;
  // Capitalized job titles are people/segments, not product identities. Keep
  // the suffix list intentionally narrow so a product such as "Vision System"
  // still needs evidence.
  return /\b(?:manager|buyer|engineer|director|officer|lead|owner|founder|procurement|purchaser|importer|distributor)s?$/.test(value);
}

export function unsupportedMaterialVisualTerms(
  script: string,
  productInfo: string,
  materialsText: string,
): string[] {
  const evidence = `${productInfo}\n${materialsText}`.toLowerCase();
  const used = MATERIAL_VISUAL_FACT_GROUPS.flatMap(group => {
    if (group.some(term => evidenceSupportsTerm(evidence, term))) return [];
    return group.filter(term => script.toLowerCase().includes(term.toLowerCase()));
  });
  return Array.from(new Set(used));
}

export function neutralizeUnsupportedMaterialVisuals(
  script: string,
  productInfo: string,
  materialsText: string,
): { script: string; warnings: string[]; neutralizedTerms: string[] } {
  const evidence = `${productInfo}\n${materialsText}`.toLowerCase();
  const unsupportedGroups = MATERIAL_VISUAL_FACT_GROUPS.filter(group => (
    !group.some(term => evidenceSupportsTerm(evidence, term))
  ));
  const neutralizedTerms = new Set<string>();
  const blocks = String(script || '').split(/(?=^[ \t]*\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\][ \t]*$)/m);
  const repaired = blocks.map(block => {
    if (!/^\s*\[\s*\d/.test(block)) return block;
    const terms = unsupportedGroups.flatMap(group => group.filter(term => block.toLowerCase().includes(term.toLowerCase())));
    if (!terms.length) return block;
    terms.forEach(term => neutralizedTerms.add(term));
    let next = block;
    const replaceField = (field: string, value: string) => {
      const pattern = new RegExp(`^[ \\t]*${field}[：:].*$`, 'm');
      if (pattern.test(next)) next = next.replace(pattern, `${field}：${value}`);
      else next = `${next.replace(/\s+$/, '')}\n${field}：${value}\n`;
    };
    replaceField('素材', '待匹配素材');
    replaceField('环境', '按后续补充素材的实际环境');
    replaceField('构图', '仅使用后续补充素材中的实际可见内容');
    replaceField('镜头功能', '待补素材');
    replaceField('画面', '待匹配素材；需补充能够证明本段信息的实际画面');
    // Unsupported visual facts must not survive in spoken or on-screen copy.
    // The CTA is deterministically restored after this pass by the caller.
    replaceField('台词', '无');
    replaceField('字幕', '无');
    return next;
  }).join('');
  const terms = Array.from(neutralizedTerms);
  return {
    script: repaired,
    neutralizedTerms: terms,
    warnings: terms.length ? [`已将素材未支持的画面替换为待匹配素材：${terms.join('、')}`] : [],
  };
}

export function materialTimelineWarningsV2(
  script: string,
  infos: StudioScriptMaterialInfo[],
): string[] {
  const ranges = storyboardSceneRanges(script);
  const warnings: string[] = [];
  const availableSceneSlots = infos.reduce((total, info) => (
    total + Math.max(1, info.observations?.filter(Boolean).length || 0)
  ), 0);
  if (ranges.length > availableSceneSlots) {
    warnings.push(`素材覆盖不足：${ranges.length}个分镜仅有${availableSceneSlots}个可信素材片段，缺口分镜已标记为待匹配`);
  }
  ranges.slice(0, infos.length).forEach((range, index) => {
    const info = infos[index];
    if ((info?.observations?.filter(Boolean).length || 0) > 1) return;
    if (!info || info.targetStart == null || info.targetEnd == null) return;
    const expectedStart = Number(info.targetStart);
    const expectedEnd = Number(info.targetEnd);
    if (!Number.isFinite(expectedStart) || !Number.isFinite(expectedEnd)) return;
    if (Math.abs(range.start - expectedStart) > 0.05 || Math.abs(range.end - expectedEnd) > 0.05) {
      warnings.push(`第${index + 1}段需在成片前重新匹配素材可用区间（建议 ${expectedStart}-${expectedEnd}s）`);
    }
  });
  return warnings;
}

export function hardScriptSafetyIssues(script: string, productInfo: string): string[] {
  const issues: string[] = [];
  const absoluteClaims = Array.from(String(script || '').matchAll(/不破|不裂|纹丝不动|吹不烂|保证|最快|最低价|全网|零缺陷|绝不漏|永不漏|no tear|won'?t tear|never breaks?|unbreakable/gi))
    .map(match => match[0]);
  if (absoluteClaims.length) issues.push(`脚本包含绝对化或不可验证承诺：${Array.from(new Set(absoluteClaims)).join('、')}`);
  const numericClaims = Array.from(String(script || '').matchAll(/\d+(?:\.\d+)?\s*(?:瓶|ml|毫升|kg|g|克|斤|cm|厘米|mm|毫米|天|day|days|%|个|pcs|件|箱|元|美元)/gi))
    .filter(match => {
      const claim = match[0];
      if (normalized(productInfo).includes(normalized(claim))) return false;
      const start = script.lastIndexOf('\n', match.index ?? 0) + 1;
      const end = script.indexOf('\n', match.index ?? 0);
      const line = script.slice(start, end < 0 ? script.length : end).trim();
      if (/%$/.test(claim) && /^(?:运镜|构图|环境|景别)[：:]/.test(line)) return false;
      if (/(?:个|件|瓶)$/.test(claim) && /^(?:运镜|构图|环境|景别|画面)[：:]/.test(line)) return false;
      if (/(?:cm|厘米|mm|毫米)$/i.test(claim) && /^(?:运镜|画面|构图|环境|景别)[：:]/.test(line)) return false;
      return true;
    })
    .map(match => match[0]);
  if (numericClaims.length) issues.push(`出现产品资料未提供的数字：${Array.from(new Set(numericClaims)).join('、')}`);
  return issues;
}

export function assessScriptQualityV2(input: {
  script: string;
  productInfo: string;
  materialsText: string;
  materialInfos: StudioScriptMaterialInfo[];
  primaryCta?: string;
  targetBuyerText?: string;
  hardIssues?: string[];
  warnings?: string[];
}): StudioScriptQualityV2Result {
  const coverageMarkedScript = markUncoveredMaterialScenes(input.script, input.materialInfos);
  const neutralized = neutralizeUnsupportedMaterialVisuals(coverageMarkedScript, input.productInfo, input.materialsText);
  const materialCoverage = materialCoverageForScript(neutralized.script, input.materialInfos);
  const warnings = Array.from(new Set([
    ...neutralized.warnings,
    ...materialTimelineWarningsV2(neutralized.script, input.materialInfos),
    ...(input.warnings || []),
  ].filter(Boolean)));
  const hardIssues = Array.from(new Set([
    ...hardScriptSafetyIssues(neutralized.script, input.productInfo),
    ...(input.hardIssues || []),
  ].filter(Boolean)));
  const needsMaterial = materialCoverage.pendingScenes > 0 || neutralized.neutralizedTerms.length > 0;
  return {
    script: neutralized.script,
    qualityStatus: hardIssues.length ? 'rejected' : needsMaterial ? 'needs_material' : warnings.length ? 'warning' : 'passed',
    hardIssues,
    warnings,
    materialCoverage,
  };
}
