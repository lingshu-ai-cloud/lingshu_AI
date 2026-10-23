import { normalizeMaterialInfos } from '../routes/studioProductScriptRules.js';
import { mixedStoryboardRules } from '../routes/mixedStoryboardContract.js';
import { SCRIPT_CREATIVE_QUALITY_RULES, scriptUnusedFacts, scriptNarrationBudget, scriptEndingRules, scriptCreativeModeRule, scriptVariantDirection } from '../prompts/scriptCreativeQuality.js';
import { productFactCandidates, selectedProductNames } from '../lib/studioScriptNormalization.js';
import { compactBriefCategory, productBrief } from '../lib/studioProductBrief.js';
import { THEME_PROMPT_CONSTRAINTS, buildScriptContentPlan, createScriptStrategyBrief, renderScriptContentPlan, type ContentTheme, type CooperationRoute } from '../strategy/scriptBrief.js';

export function compileStudioScriptStrategy(input: {
  productInfo: string;
  videoTheme: Record<string, unknown>;
  normalizedMaterialInfos: ReturnType<typeof normalizeMaterialInfos>;
  audience: string;
  generationMode: string;
  duration: number;
  language: string;
  cooperationRoute: string;
  platform: string;
  product: string;
  voiceoverMode: string;
  tone: string;
  existingScripts: unknown[];
  variantSeed: number;
  lang: string;
  forbiddenLine: string;
  openingHookOnly: boolean;
}) {
  const { productInfo, videoTheme, normalizedMaterialInfos, audience, generationMode, duration, language, cooperationRoute, platform, product, voiceoverMode, tone, existingScripts, variantSeed, lang, forbiddenLine, openingHookOnly } = input;

const selectedProductBrief = productBrief(productInfo);
  const selectedProductCategory = selectedProductBrief.category || compactBriefCategory(selectedProductBrief);
  const normalizedVideoTheme = typeof videoTheme === 'object' && videoTheme ? videoTheme as Record<string, unknown> : {};
  const presentationMode = String(normalizedVideoTheme.presentationMode || 'material');
  const presentationRule = presentationMode === 'avatar'
    ? '成片方式：纯数字人口播。每一镜均为所选数字人面对镜头讲述，不插入产品实拍或生成物品动作；产品资料只用于口播事实。'
    : presentationMode === 'heygen'
      ? '成片方式：数字人加素材混剪。默认数字人开场和收尾，中段按已选产品素材事实配画；用户可在分镜表修改画面来源，不把整片写成数字人。'
      : '成片方式：纯素材剪辑。画面只使用已授权素材，不安排生成的数字人。';
  const mixedRules = mixedStoryboardRules(presentationMode, normalizedMaterialInfos);
  const videoThemeId = String(normalizedVideoTheme.id || 'buyer_pain');
  const videoThemeTitle = String(normalizedVideoTheme.title || '买家痛点');
  const videoThemePainPoint = String(normalizedVideoTheme.painPoint || audience || '').trim();
  const contentGoal = generationMode === 'product' && normalizedVideoTheme.contentGoal === 'reach' ? 'reach' : 'leads';
  const primaryCta = String(normalizedVideoTheme.primaryCta || normalizedVideoTheme.conversionGoal || '').trim();
  const endingRules = scriptEndingRules(contentGoal, primaryCta);
  const narrationBudget = scriptNarrationBudget(Number(duration), language);
  const themeConstraint = THEME_PROMPT_CONSTRAINTS[videoThemeId as ContentTheme] ?? THEME_PROMPT_CONSTRAINTS.buyer_pain;
  const modeForStrategy = generationMode === 'material'
    ? 'asset_library'
    : generationMode === 'clone'
      ? 'viral_remix'
      : 'product_info';
  const allowedRoutes: CooperationRoute[] = ['oem_odm', 'wholesale_distribution', 'consumer_retail'];
  const requestedRoute = String(cooperationRoute || '');
  const strategyRoute: CooperationRoute = allowedRoutes.includes(requestedRoute as CooperationRoute)
    ? requestedRoute as CooperationRoute
    : /retail|consumer|终端|零售/i.test(audience)
      ? 'consumer_retail'
      : /wholesale|distributor|importer|经销|进口|渠道/i.test(audience)
        ? 'wholesale_distribution'
        : 'oem_odm';
  const strategyBrief = createScriptStrategyBrief({
    generationLayer: 'primary_script',
    generationMode: modeForStrategy,
    contentTheme: videoThemeId as ContentTheme,
    cooperationRoute: strategyRoute,
    targetBuyerRoles: audience.trim() ? [audience.trim()] : [],
    platform,
    languagePlan: [language],
    targetDurationSec: Math.max(5, Number(duration) || 20),
    // The UI's theme pain point is a category description, not a buyer-specific
    // question. Let the strategy compiler produce a concrete route/theme question
    // unless a future explicit buyer-question field is supplied.
    buyerQuestions: [],
    approvedFacts: product.trim() ? [{ label: '本次选定产品资料', value: product.trim(), source: 'product' }] : [],
    availableEvidence: generationMode === 'material'
      ? normalizedMaterialInfos.map(item => ({ label: String(item.name || '未命名素材'), type: 'material' as const }))
      : product.trim() ? [{ label: '企业产品资料', type: 'product_detail' as const }] : [],
    primaryCta: primaryCta || (contentGoal === 'reach' ? '' : '私信了解产品资料'),
    verifiedCtaChannels: primaryCta ? ['user_selected'] : [],
    forbiddenClaims: themeConstraint.prohibitedPatterns,
  });
  const contentPlan = buildScriptContentPlan(strategyBrief);
  const strategyPlanRules = renderScriptContentPlan(contentPlan);
  const voiceoverDirective = voiceoverMode === 'unselected'
    ? '声音策略：用户尚未选择配音方式。分镜可提供简短台词草案，也可写“无”；不得因口播数量阻断分镜生成。'
    : voiceoverMode === 'none'
      ? '声音策略：用户已明确选择无口播。所有台词必须写“无”，信息由画面、字幕和配乐承担。'
    : generationMode === 'clone'
      ? '声音策略：用户选择重建口播。若原片存在口播位，可在对应位置写短台词；不得增加原片不存在的口播镜头。'
      : '声音策略：用户选择 AI 口播。每个承担钩子、问题、证据、决策或 CTA 的关键分镜都必须有完整自然口播；先按完整句子安排时长，禁止截断句子。台词与字幕必须逐字一致。';
  const videoThemeRules = `本条主题：${videoThemeTitle}
受众关注：${videoThemePainPoint || '从本次产品与素材中选择一个具体看点'}
主题方向：${contentPlan.hookFormula}
禁用表达：${themeConstraint.prohibitedPatterns.join('；')}
${voiceoverDirective}
${endingRules}`;
  const creativeRules = `${SCRIPT_CREATIVE_QUALITY_RULES}
${scriptCreativeModeRule(generationMode)}`;
  const scriptFactRules = `事实边界：选定产品资料提供产品事实，素材观察只证明可见画面，对标只提供结构与节奏。数字、单位、性能和功能关系只能来自产品资料；不得补造精度、响应速度、价格、MOQ、交期、认证、功效或案例。保留适用条件。“支持某能力”不能扩写成自动完成、实时同步、免操作等未给定结论。制作参数不是产品卖点；不借用其他产品事实。`;
  const cloneMigrationMode = String(tone).includes('高保真复刻')
    ? 'fidelity'
    : String(tone).includes('机制借鉴')
    ? 'mechanism'
    : 'structure';
  const cloneMigrationPolicy = cloneMigrationMode === 'fidelity'
    ? '当前为“高保真复刻”：产品展示逻辑兼容，可保留环境、动作、构图和镜头顺序，但必须替换竞品品牌、型号、参数与不支持的事实。'
    : cloneMigrationMode === 'mechanism'
    ? '当前为“机制借鉴”：只保留钩子类型、信息揭示顺序、证明位置和节奏；环境、主体动作、构图与细节证明均按企业产品和现有素材重建。'
    : '当前为“结构迁移”：保留原片的时长比例、镜头功能、证明顺序、景别节奏与音画密度；必须按企业产品重建环境、主体动作和可见证据，禁止沿用跨品类场景和物体。';
  const cloneFusionRules = `爆款素材迭代规则（只在内部执行，不要输出规则或解释）：
0. ${cloneMigrationPolicy}
1. REFERENCE_ANALYSIS 是灵感大屏已经完成的原视频分析，是原片结构、音画和爆点的唯一事实来源；禁止重新分析、重新定义或套用固定营销模板。
2. 原分析有多少段就输出多少段；逐段保留时间、顺序、时长比例、镜头功能、景别节奏、配乐和节拍。环境、构图与动作是否保留必须服从第 0 条迁移方式。不得合并、补段、重排或改成固定 5 段。
3. 爆点可能是视觉揭晓、动作、反差、细节、音效、卡点、人物反应、字幕或 CTA，不得把“采购痛点”默认当作爆点。
4. 只做受约束的产品替换：把原产品对象、品牌和型号替换为“产品信息”中的选定产品；没有冲突的场景、动作、镜头关系和节奏全部保留。
5. 原片没有口播就输出“台词：无”；原片没有屏幕文字就输出“字幕：无”；原片没有 CTA 就不得新增 CTA。
6. 不得新增人物、剧情、CTA 或镜头功能。但必须在原片现有的产品展示、细节特写、口播或字幕位中，写入选定产品名称和至少 1 个企业中心已核实事实（如规格、材质、定制能力、MOQ 或认证）；只能使用产品资料中真实存在的字段。
7. 不得把分析中的表达意图、改编建议、未展示因果写进实际画面；只允许使用原分析记录的可见、可听内容。
8. 缺失信息用“无”或“沿用原片”表达，禁止用想象补齐。分析缺少逐镜详情时应拒绝生成，不得降级为自由创作。
9. 输出必须干净：只输出时间戳分镜成稿，不输出标题、前言、总结、映射表、自检、Markdown、代码围栏或分析说明。`;
  const previousCloneScripts = Array.isArray(existingScripts)
    ? existingScripts.map(item => String(item || '').trim()).filter(Boolean).slice(-4)
    : [];
  const priorNarration = previousCloneScripts.flatMap(item => Array.from(item.matchAll(/^台词[：:]\s*(.+)$/gm)).map(match => match[1])).join(' ').replace(/\s/g, '').toLowerCase();
  const productFacts = productFactCandidates(product);
  const unusedProductFacts = scriptUnusedFacts(productFacts, priorNarration);
  const planningProduct = generationMode === 'product' && selectedProductNames(product).length === 1 && productFacts.length
    ? `产品名称：${selectedProductNames(product).join('、')}\n本轮可用事实：\n${(unusedProductFacts.length ? unusedProductFacts : productFacts).map(fact => `- ${fact}`).join('\n')}`
    : product;
  const cloneDiversityRules = previousCloneScripts.length
    ? `\n当前生成第 ${Math.max(1, Number(variantSeed) + 1)} 版。以下是已经生成的版本，仅用于排重，严禁复制：\n${previousCloneScripts.map((item, index) => `--- 已有版本 ${index + 1} ---\n${item.slice(0, 6000)}`).join('\n')}\n新版本必须保持原片时间轴和镜头功能，但至少改变以下三项：开场呈现动作、产品证明动作、场景陈设、镜头内产品顺序、台词句式、字幕表达。不得只替换同义词。`
    : '';

  const productDuration = Math.max(10, Number(duration) || 20);
  const productSceneCount = productDuration <= 30 ? 4 : productDuration <= 45 ? 6 : 8;
  // Only shorten an explicit leading model token, never invent a Chinese alias.
  const spokenName = (name: string) => /^[A-Za-z][A-Za-z0-9-]*\s+/.test(name) ? name.split(/\s+/)[0] : name;
  const packagingOnlyProductConstraint = /(?:无品牌瓶器|空白标签|外盒样品|包装方案)/.test(productInfo)
    && !/(?:防漏|密封|耐用|抗[压拉摔]|测试|容量|尺寸|材质|认证|交期|MOQ|起订)/i.test(productInfo)
    ? '本次产品资料仅证明容器/包装样品可提供：画面只能建议拍摄容器摆放、空白标签/外盒组合和手部排布；不得虚构瓶内液体、性能测试、厚薄、毛边、回弹、色差、密封、耐用、PDF资料或邮件界面。'
    : '';
  const productScriptRules = `为选定产品生成 ${productDuration} 秒、${productSceneCount} 段的 ${lang} 分镜稿。
时间从0开始连续无重叠，按完整口播与动作分配时长；中文约每秒4字并留停顿，不能截断句子。
${voiceoverDirective}
${presentationRule}
有口播时字幕逐字相同；无口播时字幕可独立传达信息。音效写入配乐字段。
每段画面写清主体、初始状态、动作和结束状态，并保持人物、产品外观和空间连续。没有现成画面可建议补拍，但产品状态、使用方式和性能结论必须有资料支持。
多选产品时，每个选定名称至少出现在一段画面中；只写输入支持的商业事实，不把参数扩写成未证实效果。
${packagingOnlyProductConstraint}
${forbiddenLine}
只输出以下格式，每段字段各出现一次，无标题、解释或 Markdown：
[start-end s]
环境：<具体场景>
景别：<景别>
运镜：<镜头运动>
构图：<主体位置与产品朝向>
镜头功能：<本段作用>
画面：<具体可执行动作；需补拍时明确标记>
配乐：<音乐或环境声/音效>
台词：<连贯口播片段，可有多句，或无>
字幕：<有口播时逐字相同>`;

  const materialScriptRules = openingHookOnly
    ? `你正在自由创作一条约 ${productDuration} 秒的产品视频。用户仅指定了开场钩子视频，其余镜头尚无素材；请用 Gemini 重新创作逐句口播和 4 至 5 段连续分镜。
第一段必须从 0 秒开始，使用素材《${normalizedMaterialInfos[0]?.name}》，只描述以下已观察画面：${normalizedMaterialInfos[0]?.observations?.join('；') || '无可靠观察'}。第一段结束不晚于 ${Number(normalizedMaterialInfos[0]?.targetEnd || 3)} 秒，不得把开场钩子复制到后续镜头。
后续每段的“素材”字段写“待匹配素材”，画面写清需要拍摄或匹配的主体、动作和结果，并以“建议补拍：”开头；不得声称这些画面已经存在。后续分镜用企业已确认的产品事实构思，未知的功能、数字、效果、认证和服务一律不编造。
逐段输出完整且连续的 [start-end s] 时间戳；总时长约 ${productDuration} 秒。口播面向买家，第一句形成停留理由，后续逐句推进，最后只保留一个企业资料支持的行动。每句要能在对应镜头自然说完；字幕与口播一致。只输出分镜成稿，每段包含且只包含：素材、环境、景别、运镜、构图、镜头功能、画面、配乐、台词、字幕。`
    : `你是在把“已选素材库片段”剪成一条有销售情绪的社媒带货/外贸留资视频。素材约束留在画面说明中，人物口播必须始终面向潜在买家，不能说后台审核语言。

核心原则：
0. 输入优先级固定为：素材分段观察决定“画面里真实有什么和能怎么剪”；本条视频主题决定“爆款模板与证明顺序”；主推产品信息决定“允许出现的产品名、卖点、数字和商业事实”。三者冲突时不得猜测，画面服从素材、事实服从产品资料。
1. 每个时间戳段必须绑定一个具体素材名，不能只写泛泛产品话术。
2. 只能根据素材元信息做保守推断：素材名、类型、角色、原始时长、建议时间段。没有真实画面识别时，不得编造画面里出现的人、场景、动作或效果。
3. “原始时长”只是文件长度，“建议有效时长”才是当前脚本可使用的动作长度。禁止为了填满目标时长而慢放、循环或重复同一个动作，除非分段观察明确支持。
4. 画面字段必须写“使用素材《素材名》...”并说明剪辑重点，例如截取开头、细节处、动作最清楚处、包装/样品处。
5. 每段承担不同剪辑任务，按实际素材数量选择开场、细节、使用/对比、供应能力、定制/包装、CTA；不得为了凑结构虚构素材不存在的功能。
6. 口播必须承接该素材的角色并形成连续销售逻辑：第一段让人停留，中段把可见细节变成购买理由，最后一段只给一个低门槛行动。不能每段复用同一句式。
7. 如果素材信息不足，只能写“按该素材可见内容剪辑”，不能伪装已经识别出画面。尤其禁止从液体滴落推断吸收、渗透、淡纹、美白、祛痘或其它功效。
8. “按可见内容剪辑、不得推断、资料可确认”只能写进画面字段，禁止出现在人物说中。禁止口播“先看素材、这段只按可见内容、逐项确认”等制作/审核腔。
9. 中文口播按每秒4字并至少预留0.6秒停顿。下面每个时间段的“口播最多字数”是硬上限，不含标点；宁可写“无”也不得超出。
10. 必须恰好生成 ${Math.max(1, normalizedMaterialInfos.length)} 段，逐行使用下方时间段和对应素材，不得改时间、交换素材、合并或增加分镜。
${normalizedMaterialInfos.map((info, index) => {
  const start = Number(info.targetStart || 0);
  const end = Number(info.targetEnd || start + 0.5);
  const maxChars = Math.max(2, Math.floor(Math.max(0.5, end - start - 0.6) * 4));
  return `- 第${index + 1}段：[${start}-${end}s]；素材《${info.name}》；中文口播最多${maxChars}字`;
}).join('\n')}
11. 数字、单位、规格、功效和认证只能逐字来自产品信息；素材名里的数字不能自动视为产品事实，也不能写进台词或字幕。
12. 输出前内部执行三次检查：时间轴连续；每段素材名正确；逐段口播字数不超限。只输出通过检查的成稿，不解释规则。

爆款模板必须服务于当前主题“${videoThemeTitle}”：钩子素材原动作完整建立停留理由 → 1-2 个与主推产品有关的可见证明 → 一个采购/使用价值解释 → 单一低门槛 CTA。不得为了套模板虚构素材中不存在的动作，也不得把无关工厂素材硬套到消费品功效。

固定格式（每段完整重复）：
[start-end s]
素材：<素材名>
环境：<仅写素材元信息支持的环境；未知写“按素材可见环境”>
景别：<远景/全景/中景/中近景/近景/特写之一>
运镜：<固定/推进/拉远/横移/跟拍/环绕之一>
构图：<主体位置、产品朝向、前中后景关系；未知时给出保守裁切方案>
镜头功能：<单一功能>
画面：<基于该素材的剪辑方式，必须提到素材名和明确截取重点>
配乐：<音乐/环境声/音效的节奏，不与口播混写>
台词：<真人能说出口的一句话；不需要则写“无”>
字幕：<短字幕>`;

  const variantRules = `${scriptVariantDirection(generationMode, variantSeed)}${previousCloneScripts.length
    ? `
已有版本（只用于排重，不作为产品事实）：
${previousCloneScripts.map(item => [...new Set(Array.from(item.matchAll(/^(?:台词|字幕)[：:]\s*(.+)$/gm)).map(match => match[1]))].join(' ').slice(0, 1200)).join('\n')}
新版本至少改变钩子切口、证据顺序、叙述视角中的两项；不能只替换同义词。`
    : ''}`;

  return { presentationRule, mixedRules, productDuration, planningProduct, videoThemeTitle, videoThemePainPoint, contentPlan, variantRules, spokenName, endingRules, narrationBudget, productSceneCount, primaryCta, presentationMode, materialScriptRules, creativeRules, scriptFactRules, videoThemeRules, productScriptRules, selectedProductCategory, cloneFusionRules, cloneDiversityRules, cloneMigrationMode, videoThemeId, strategyRoute, contentGoal, strategyPlanRules, voiceoverDirective, previousCloneScripts };
}
