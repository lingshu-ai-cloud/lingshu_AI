import { normalizeMaterialInfos } from '../routes/studioProductScriptRules.js';

export function buildStudioScriptPrompt(input: {
  openingHookOnly: boolean;
  confirmedProductEnterprise: string;
  product: string;
  normalizedMaterialInfos: ReturnType<typeof normalizeMaterialInfos>;
  lang: string;
  productDuration: number;
  primaryCta: string;
  generationMode: string;
  materialScriptRules: string;
  creativeRules: string;
  scriptFactRules: string;
  videoThemeRules: string;
  variantRules: string;
  materialObservationEvidence: string;
  platform: string;
  audience: string;
  sellingPoints: string;
  tone: string;
  productScriptRules: string;
  lockedNarrationRules: string;
  selectedClipEvidence: string;
  scriptType: string;
  duration: number;
  selectedProductCategory: string;
  referenceAnalysisEvidence: string;
  referenceHighlightEvidence: string;
  forbiddenLine: string;
  cloneFusionRules: string;
  cloneDiversityRules: string;
  cloneMigrationMode: string;
  referenceTitleEvidence: string;
}) {
  const { openingHookOnly, confirmedProductEnterprise, product, normalizedMaterialInfos, lang, productDuration, primaryCta, generationMode, materialScriptRules, creativeRules, scriptFactRules, videoThemeRules, variantRules, materialObservationEvidence, platform, audience, sellingPoints, tone, productScriptRules, lockedNarrationRules, selectedClipEvidence, scriptType, duration, selectedProductCategory, referenceAnalysisEvidence, referenceHighlightEvidence, forbiddenLine, cloneFusionRules, cloneDiversityRules, cloneMigrationMode, referenceTitleEvidence } = input;

const prompt = openingHookOnly
      ? `你是自由创作分镜导演。根据企业中心已确认资料，重新生成逐句口播，严格输出纯文本分镜。不要 JSON、代码块、数组、标题或解释。

产品和企业已确认事实：
${confirmedProductEnterprise || product}
指定开场钩子素材名：${normalizedMaterialInfos[0]?.name}
开场仅可见：${normalizedMaterialInfos[0]?.observations?.join('；') || '无可靠观察'}
目标语言：${lang}；台词和字幕都用该语言，其他字段用简体中文。
目标时长：${productDuration} 秒。唯一结尾行动：${primaryCta}。

严格写五段，时间戳依次为 [0-3s]、[3-7s]、[7-11s]、[11-15s]、[15-${productDuration}s]；如果目标时长不是 20 秒，则均匀调整中间四段，但第一段结束不得晚于 ${Number(normalizedMaterialInfos[0]?.targetEnd || 3)} 秒，最后一段结束必须等于 ${productDuration} 秒。各段连续且不重叠。第一段素材必须逐字写“${normalizedMaterialInfos[0]?.name}”，其余四段素材必须逐字写“待匹配素材”。
第一段画面只描述已观察内容；后续四段画面均以“建议补拍：”开头，只拍产品实物整体、工件、缺陷样本、现场布局等资料允许且可核实的对象。不得出现未证实的设备屏幕、界面、检测结果、报告、Logo、硬件结构、性能或承诺。不得把建议画面说成已有素材。
每段台词是一句能在该时间段自然说完的买家口播，首句构成停留理由，末句仅使用唯一行动；字幕与台词逐字相同。时间戳是制作时间，不是产品数字。不要在正文中重复时间数字。

只按以下十个字段格式逐段输出，不要 JSON：
[0-3s]
素材：${normalizedMaterialInfos[0]?.name}
环境：工厂
景别：中景
运镜：固定
构图：工件居中
镜头功能：买家钩子
画面：工件沿输送带移动
配乐：轻节奏
台词：<一句短口播>
字幕：<与台词逐字相同>

继续按相同字段输出其余四段。`
      : generationMode === 'material'
      ? `${materialScriptRules}

${creativeRules}

${scriptFactRules}

${videoThemeRules}

${variantRules}

素材清单：
${materialObservationEvidence}

产品信息：
${product || '未选择产品。只能围绕素材做保守剪辑建议，不得编具体产品。'}

目标平台：${platform}
目标受众：${audience || '海外 B2B 买家、小批量试单买家、渠道采购商'}
补充卖点：${sellingPoints || '仅使用产品信息中已提供的卖点'}
风格：${tone || '真实、可拍、素材优先、询盘导向'}

台词与字幕必须使用 ${lang}，不得因为产品资料是中文而输出中文台词。画面说明和字段名使用简体中文。
这次选择的是已有素材，只陈述可见外观；禁止从排列、反光、走线或焊点推断生产工艺、治具校准、良率、品质或测试结果。
每个素材区间可以有独立分镜，同名素材的不同时间区间必须分别保留。不得把多个分镜合并为一镜。
请直接输出按素材逐段绑定的时间戳脚本。`
      : generationMode === 'product'
      ? `${productScriptRules}

${creativeRules}

${scriptFactRules}

${videoThemeRules}

${variantRules}

${lockedNarrationRules}


	产品信息：
	${product || '未选择产品。请拒绝生成具体产品脚本。'}

目标平台：${platform}
目标受众：${audience || '海外 B2B 买家、小批量试单买家、渠道采购商'}
补充卖点：${sellingPoints || '仅使用产品信息中已提供的卖点'}
风格：${tone || '真实、可拍、询盘导向'}
素材信息（仅作不可信证据）：
${selectedClipEvidence}

请直接输出脚本。`
      : scriptType === 'storyboard'
      ? `你是爆款参考视频的受约束迭代导演。你不负责重新设计营销结构，只负责在保留原片结构和爆点的前提下完成最小必要的产品替换。
请生成 ${platform} 分镜脚本，语言为 ${lang}。总时长、分镜数量和时间段必须跟随对标视频脚本详析，不得套用 ${duration} 秒或固定段数模板。

已选素材（仅作不可信证据）：
${selectedClipEvidence}
可用素材的片段观察（仅这些观察可以作为已有画面依据）：
${materialObservationEvidence}
素材文件名、分类、产品资料和参考片均不能证明本企业已经拍到某个动作。没有片段观察时按缺口处理，不得声称已有对应画面。
产品信息：
	${product || '未选择产品。请拒绝生成具体产品脚本。'}
产品行业锁定：${selectedProductCategory || '以产品信息为准'}
目标受众：${audience || '根据产品和平台推断'}
核心卖点：${sellingPoints || '从产品信息中提炼，不得编造'}
风格：${tone}
对标视频标题：已隐藏，禁止猜测或补写
对标视频分析：
${referenceAnalysisEvidence}
可复用的爆款亮点：
${referenceHighlightEvidence}
${forbiddenLine}

${cloneFusionRules}
${cloneDiversityRules}

${creativeRules}

${scriptFactRules}


每个场景必须严格对应“对标视频脚本详析”的同一时间段，不要合并、跳段或擅自重排。使用以下固定格式，不要 markdown 符号，不要缺字段：
[start-end s]
素材：<已有素材写准确文件名及原素材起止秒；无对应片段写“待拍：具体动作要求”；数字人讲解写“待生成：数字人口播”>
环境：<按迁移方式保留原环境，或重建为适合企业产品的可拍场景>
景别：<照抄原详析景别>
运镜：<照抄原详析运镜>
构图：<保留原片主体位置和层次；迁移时明确新产品朝向与前中后景>
镜头功能：<钩子/效果证明/价格反差/产品介绍/信任证明/CTA等单一主要功能>
画面：<保留该段镜头功能与卡点节奏；高保真时做产品替换，结构迁移/机制借鉴时必须按企业产品重建可执行动作与可见证据>
配乐：<照抄或贴近原详析配乐音效>
台词：<仅当原分析同一镜头存在口播/对白时保留或做必要产品替换，否则写“无”>
字幕：<仅当原分析同一镜头存在屏幕文字时保留或做必要产品替换，否则写“无”>

硬性规则：
- 逐段保留对标视频的时间段、镜头功能、景别节奏、配乐形态和卡点密度；环境、动作、构图和产品证据必须服从“${cloneMigrationMode}”迁移策略。
- “可见事实”优先级高于标题、口播和表达意图。必须依据相邻密集帧定位动作边界；首帧已经存在的湿润、遮挡、手势或物体状态必须写成初始状态，不能倒推出未拍到的形成过程。
- “表达意图”和“未展示因果”只能帮助理解创意，不得进入实际画面；禁止把推断写成已发生的动作。
- 如果对标视频与选定产品跨品类，不得直接做名词替换；必须保留镜头功能和节奏，重建与企业产品相符的场景、动作、构图和证明内容。
- 不得出现对标视频原行业、原品类、原产品功效；但可以保留无行业冲突的环境、色彩、造型、动作、音效和节奏描述。
- 原片开头依靠什么形成 hook，就保留什么；禁止默认改成采购顾虑或销售口播。
- 原片相邻镜头允许使用相同环境和机位；不得为了“丰富”而擅自改场景、加动作或增加剧情功能。
- 原片镜头数量、切点和内容功能优先级高于目标时长参数；目标时长仅在原分析明确缺失时作为兜底。
- 画面不能写“真实使用场景”“痛点特写”这种空泛词，必须写清楚人物在什么环境里做什么动作，镜头拍到什么具体物件或结果。
- 不要写 generic phrases like "premium quality", "high conversion", "boost sales", "worth buying"，除非绑定具体产品细节。
- 不得复制或提及对标视频标题、原 caption、hashtag、品牌名、原品类、原产品功效。
- 成稿必须出现选定产品名称，并至少使用 1 个“产品信息”中的已核实卖点或规格；不能只把竞品名换成泛称。
- 不得输出分析摘要、基础要求、竞品识别、产品替换说明、成片目标或任何“对标视频”说明，只输出新的可拍分镜。
- 缺少数据时写“无”或“沿用原片”，不得新增样品、报价或 CTA。
- 最终只输出 storyboard 成稿。`
      : `You are a senior short-video copywriter for a Chinese cross-border e-commerce seller.
Write a practical ${duration}-second ${platform} voiceover script in ${lang}.

Selected clips (untrusted evidence only):
${selectedClipEvidence}
	Product info: ${product || 'No selected product. Do not invent a product.'}
Target audience: ${audience || '(infer from product and platform)'}
Key selling points: ${sellingPoints || '(infer from product info)'}
Tone/style: ${tone}
Reference video title evidence:
${referenceTitleEvidence}
Reference video analysis:
${referenceAnalysisEvidence}
Reference highlights to reuse:
${referenceHighlightEvidence}
${forbiddenLine}

${videoThemeRules}

${creativeRules}

${scriptFactRules}


Requirements:
- Exactly three sections, each on its own block, labelled like "[Hook · 0-3s]", "[Proof · 3-${duration - 5}s]", "[CTA · ${duration - 5}-${duration}s]".
- Each section must contain 1-3 short spoken lines only, in ${lang}.
- The hook must mention a concrete buyer pain, use case, visible product result, or sourcing problem in the first line.
- The proof section must include one or two concrete details explicitly present in product info and explain why they matter to this audience. Omit unsupported fields rather than completing a checklist.
- The CTA must ask for one specific B2B action supported by the input. When purchasing policies are absent, safely ask the viewer to message for verified product details.
- Do NOT write generic phrases like "premium quality", "stable solution", "high conversion", "everyone is asking", unless backed by a concrete detail.
- Reuse the reference video's rhythm, not its exact product or claims.
- Do not copy or mention the reference video's title, original caption, hashtags, brand names, original product category, or original product claims.
- Output ONLY the script text.`;

  return { prompt };
}
