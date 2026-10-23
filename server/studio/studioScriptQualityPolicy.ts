import { applyLockedVoicePlan, ctaSemanticallySatisfied, duplicateStoryboardFieldIssues, normalizeStoryboardFieldLines, restoreProductStoryboardBoundaries, storyboardSpeechIssues, subtitleVoiceMismatchIssues, syncStoryboardSubtitles } from '../routes/studioStoryboardSpeechRules.js';
import { isBeautyProductInfo, isPackagingOnlyProductInfo, normalizeMaterialInfos, openingMatchesCooperationRoute, openingMatchesTargetBuyer, parseLockedStoryboardScenes, repairMaterialScript, requiresMinimumVoiceoverLines } from '../routes/studioProductScriptRules.js';
import { mixedStoryboardIssues } from '../routes/mixedStoryboardContract.js';
import { auditCommercialClaims, storyboardReferenceLeakIssues, unsupportedNumericClaims } from '../lib/studioGenerationTruthfulness.js';
import { enforceProductNameInScript, ensureSelectedProductNamesInScript, normalizeProductIdentity, normalizeScriptTimestamps, selectedProductNames, stripScriptAnalysisSummary } from '../lib/studioScriptNormalization.js';
import { type ContentTheme, type CooperationRoute } from '../strategy/scriptBrief.js';

export function createStudioScriptQualityPolicy(input: {
  productInfo: string;
  generationMode: string;
  hasNarrationDraft: boolean;
  lockedVisualScenes: ReturnType<typeof parseLockedStoryboardScenes>;
  lockedVoiceLines: string[];
  isStructuredLockedDraft: boolean;
  structuredMaterials: string;
  primaryCta: string;
  voiceoverMode: string;
  videoThemeId: string;
  videoThemeTitle: string;
  audience: string;
  strategyRoute: CooperationRoute;
  confirmedProductEnterprise: string;
  presentationMode: string;
  normalizedMaterialInfos: ReturnType<typeof normalizeMaterialInfos>;
  forbiddenTerms: string[];
  forbiddenIndustryTerms: string[];
  productSceneCount: number;
  productDuration: number;
  scriptType: string;
}) {
  const { productInfo, generationMode, hasNarrationDraft, lockedVisualScenes, lockedVoiceLines, isStructuredLockedDraft, structuredMaterials, primaryCta, voiceoverMode, videoThemeId, videoThemeTitle, audience, strategyRoute, confirmedProductEnterprise, presentationMode, normalizedMaterialInfos, forbiddenTerms, forbiddenIndustryTerms, productSceneCount, productDuration, scriptType } = input;

const normalizeGeneratedScript = (value: string) => {
      let normalized = normalizeStoryboardFieldLines(normalizeScriptTimestamps(ensureSelectedProductNamesInScript(enforceProductNameInScript(stripScriptAnalysisSummary(value), productInfo), productInfo)));
      if (generationMode === 'product') {
        if (hasNarrationDraft && !lockedVisualScenes.length) normalized = applyLockedVoicePlan(normalized, lockedVoiceLines);
        // The deterministic locked draft already owns a valid, target-sized
        // timeline. Rebuilding its ranges from speech would collapse planned
        // visual breathing room (for example 20 seconds back to 12 seconds).
        if (!isStructuredLockedDraft) normalized = restoreProductStoryboardBoundaries(normalized);
      }
      if (generationMode === 'material') normalized = repairMaterialScript(normalized, productInfo, structuredMaterials);
      if (hasNarrationDraft) normalized = syncStoryboardSubtitles(normalized);
      return normalized;
    };
    const strictCommercialPolicyIssues = (candidate: string): string[] => {
      const issues: string[] = [];
      if (/零残留|无挂壁|无气泡|零瑕疵|零缺陷|完全密封|绝不漏|永不漏|无划痕|无毛边|无色差|回弹(?:顺畅|稳)|资料齐全|随时可用|可追溯(?:的)?规格|真实材质(?:与)?结构|厚度差异|结构真实性|可信对比源/i.test(candidate)) {
        issues.push('资料未支持的产品表现、测试结论或文件主张');
      }
      if (/不破|不裂|纹丝不动|吹不烂|保证|最快|最低价|全网|no tear|won'?t tear|never breaks?|unbreakable/i.test(candidate)) {
        issues.push('绝对化或不可验证承诺');
      }
      if (/(?:马上|立即|免费|可)?寄样|寄送样品|免费样品/i.test(candidate)) {
        issues.push('资料未支持的寄样或样品政策承诺');
      }
      const ctaSatisfied = ctaSemanticallySatisfied(candidate, primaryCta);
      if (generationMode !== 'clone' && !ctaSatisfied) {
        issues.push(`未使用本条唯一主 CTA：${primaryCta}`);
      }
      const spokenLines = Array.from(candidate.matchAll(/^台词[：:]\s*(.+)$/gm))
        .map(match => String(match[1] || '').trim())
        .filter(line => line && !/^(无|none|no voiceover)$/i.test(line));
      if (requiresMinimumVoiceoverLines(voiceoverMode, generationMode) && spokenLines.length < 2) {
        issues.push('已选择 AI 口播，但有效台词不足两段');
      }
      return issues;
    };
    const strategyExecutionIssues = (candidate: string): string[] => {
      // This is a quality gate, not a fact gate. It catches the common failure
      // where a model obeys the storyboard schema but opens with a product name
      // instead of the selected buyer's decision problem.
      const firstScene = String(candidate || '').split(/(?=^\[[^\]\r\n]+\][ \t]*$)/m).find(block => /^\[[^\]]+\]/.test(block.trim())) || '';
      const firstVoice = (firstScene.match(/^台词[：:]\s*(.+)$/m)?.[1] || '').trim();
      const firstCaption = (firstScene.match(/^字幕[：:]\s*(.+)$/m)?.[1] || '').trim();
      const firstVisual = (firstScene.match(/^画面[：:]\s*(.+)$/m)?.[1] || '').trim();
      const opening = `${firstVoice} ${firstCaption} ${firstVisual}`.replace(/\s+/g, ' ').trim();
      const issues: string[] = [];
      const productNameOpening = selectedProductNames(productInfo).some(name => {
        const normalized = normalizeProductIdentity(name);
        return normalized && normalizeProductIdentity(firstVoice).startsWith(normalized);
      });
      if (generationMode !== 'clone' && (productNameOpening || !/[？?]|怎么|如何|为什么|别只|先别|看不出|难以|担心|选择|确认|判断|采购|品牌方|经销|进口|\b(?:how|why|which|what|buyer|brand|procurement|sourcing|choose|decide|verify|concern|risk|problem)\b/i.test(opening))) {
        issues.push('首段没有先给目标买家的具体决策问题或判断反差，仍像产品自我介绍');
      }
      const themeOpeningPatterns: Partial<Record<ContentTheme, RegExp>> = {
        buyer_pain: /采购|品牌方|品牌创始人|买家|经销|进口|担心|难以|问题|选择|判断|\b(?:buyer|brand|procurement|sourcing|concern|risk|problem|choose|decision)\b/i,
        product_proof: /目录|实物|细节|怎么|如何|看不出|判断|确认|\b(?:catalog|physical|detail|verify|check|judge|confirm|proof)\b/i,
        customization: /品牌方|包装|打样|标签|外盒|确认|适配|\b(?:brand|packaging|sample|prototype|label|carton|confirm|fit|custom)\b/i,
        comparison: /怎么选|如何选|区别|差异|选择|对比|\b(?:choose|choice|difference|compare|comparison|versus|vs)\b/i,
        supplier_capability: /供应|交付|质检|生产|补货|确认|风险|\b(?:supply|delivery|quality|inspection|production|fulfillment|risk|verify)\b/i,
        talking_head: /我|我们|你|采购|品牌方|问题|为什么|怎么|\b(?:I|we|you|buyer|brand|procurement|question|why|how)\b/i,
      };
      const expected = themeOpeningPatterns[videoThemeId as ContentTheme];
      if (generationMode !== 'clone' && expected && !expected.test(opening)) {
        issues.push(`首段没有执行“${videoThemeTitle}”主题的钩子公式`);
      }
      if (generationMode !== 'clone' && !String(audience || '').trim() && !openingMatchesCooperationRoute(opening, strategyRoute)) {
        issues.push('首段没有点名当前合作路线对应的目标买家');
      }
      if (generationMode !== 'clone' && !openingMatchesTargetBuyer(opening, audience)) {
        issues.push('首段没有使用本条企业策略配置的目标买家');
      }
      const functions = Array.from(String(candidate || '').matchAll(/^镜头功能[：:]\s*(.+)$/gm)).map(match => match[1]!.trim());
      if (functions.length > 2 && new Set(functions).size < Math.min(3, functions.length)) {
        issues.push('分镜功能重复，未形成钩子、问题、证据、决策和 CTA 的推进');
      }
      if (isBeautyProductInfo(productInfo) && !isPackagingOnlyProductInfo(productInfo) && (['product_proof', 'use_case'].includes(videoThemeId) || strategyRoute === 'consumer_retail')) {
        const scenes = String(candidate || '').split(/(?=^\[[^\]\r\n]+\][ \t]*$)/m).filter(block => /^\[[^\]]+\]/.test(block));
        const productScenes = scenes.filter(scene => /膏体|旋出|旋回|唇部|手背|化妆包|涂抹/.test(scene)).length;
        const packagingScenes = scenes.filter(scene => /标签|外盒|包装|牛皮纸|白管/.test(scene)).length;
        if (scenes.length >= 3 && (productScenes < Math.ceil(scenes.length * 2 / 3) || packagingScenes > 1)) {
          issues.push('美妆产品本体镜头不足，包装信息不应主导产品实证、使用场景或C端脚本');
        }
      }
      return issues;
    };
    const repairableIssues = (candidate: string): string[] => {
      const unsupported = unsupportedNumericClaims(candidate, confirmedProductEnterprise);
      const commercialAudit = auditCommercialClaims(candidate, confirmedProductEnterprise);
      const issues = unsupported.length ? [`资料外数字：${unsupported.join('、')}`] : [];
      issues.push(...commercialAudit.issues);
      issues.push(...mixedStoryboardIssues(candidate, presentationMode, normalizedMaterialInfos));
      if (/不破|不裂|纹丝不动|吹不烂|保证|最快|最低价|全网|no tear|won'?t tear|never breaks?|unbreakable/i.test(candidate)) {
        issues.push('绝对化或不可验证承诺');
      }
      const normalizedCandidateIdentity = normalizeProductIdentity(candidate);
      const missingNames = selectedProductNames(productInfo).filter(name => {
        const normalizedName = normalizeProductIdentity(name);
        return normalizedName.length > 0 && !normalizedCandidateIdentity.includes(normalizedName);
      });
      if (missingNames.length) issues.push(`未完整写入选定产品名称：${missingNames.join('、')}`);
      issues.push(...strictCommercialPolicyIssues(candidate));
      // Editorial keyword heuristics are advisory, never model-repair triggers.
      issues.push(...duplicateStoryboardFieldIssues(candidate));
      issues.push(...subtitleVoiceMismatchIssues(candidate));
      issues.push(...storyboardSpeechIssues(candidate));
      if (generationMode === 'clone') {
        issues.push(...storyboardReferenceLeakIssues(candidate, forbiddenTerms, forbiddenIndustryTerms));
      }
      return issues;
    };
    const repairFormat = generationMode === 'product'
      ? `必须保留${lockedVoiceLines.length || productSceneCount}段及每段完整字段；可重新计算时间戳以容纳完整自然口播，总时长保持约${productDuration}秒，时间连续无重叠。`
      : generationMode === 'material'
        ? '必须保留原有时间段、素材绑定和每段字段，不得新增素材或臆造素材画面。'
        : scriptType === 'storyboard'
          ? '必须保留原有对标时间段、镜头数量和字段，不得重排镜头。'
          : '必须保留原有三个区块和时长标签。';

  return { normalizeGeneratedScript, repairableIssues, repairFormat, strictCommercialPolicyIssues, strategyExecutionIssues };
}
