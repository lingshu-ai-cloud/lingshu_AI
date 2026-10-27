export type AssistantHomePromptGroupId = 'operations' | 'inspiration' | 'content' | 'publishing' | 'ads' | 'customer' | 'enterprise';
export type AssistantHomePromptLevel = 'query' | 'plan' | 'sensitive' | 'navigation';

export interface AssistantHomePromptGroup {
  id: AssistantHomePromptGroupId;
  label: string;
  description: string;
}

export interface AssistantHomePrompt {
  id: string;
  group: AssistantHomePromptGroupId;
  label: string;
  summary: string;
  prompt: string;
  level: AssistantHomePromptLevel;
}

export type AssistantHomeQuickLauncherId =
  | 'weekly-plan'
  | 'external-news'
  | 'business-analysis'
  | 'viral-script'
  | 'customer-followup'
  | 'traffic-optimization';

export interface AssistantHomeQuickLauncher {
  id: AssistantHomeQuickLauncherId;
  label: string;
  description: string;
  promptIds: readonly string[];
}

export const ASSISTANT_HOME_PROMPT_GROUPS: AssistantHomePromptGroup[] = [
  { id: 'operations', label: '经营与决策', description: '周任务、资讯、策略与经营数据' },
  { id: 'inspiration', label: '灵感与素材', description: '趋势、对标内容与待拍素材' },
  { id: 'content', label: '内容创作', description: '脚本、分镜、图片与制作审核' },
  { id: 'publishing', label: '发布与账号', description: '排期、文案、账号与发布回执' },
  { id: 'ads', label: '智能投流', description: '投放分析、计划、预算与风险' },
  { id: 'customer', label: '智能客服', description: '询盘、回复、报价与客户跟进' },
  { id: 'enterprise', label: '企业与连接', description: '知识库、数字人与平台连接' },
];

const defineGroup = (group: AssistantHomePromptGroupId, entries: Array<Omit<AssistantHomePrompt, 'group'>>): AssistantHomePrompt[] => (
  entries.map(entry => ({ ...entry, group }))
);

export const ASSISTANT_HOME_PROMPTS: AssistantHomePrompt[] = [
  ...defineGroup('operations', [
    { id: 'OP-CALENDAR', label: '查看本周发布日历', summary: '只读查看本周已有发布安排与发布时间待定的内容', level: 'query', prompt: '帮我查看本周发布日历，看看哪些内容已发布、哪些待发布，以及哪些事项需要我处理。' },
    { id: 'OP-01', label: '周经营任务', summary: '查看本周进度、阻塞和今天最优先动作', level: 'query', prompt: '请读取当前企业本周目标、周计划、真实任务、依赖关系和最新运行回执，按“当前状态、已完成、待处理、阻塞项、今天最优先动作”总结本周经营任务。缺少数据时请明确指出；不要自动创建、启动或修改任务。如建议执行，请先给出可确认的计划摘要。' },
    { id: 'OP-02', label: '今日资讯', summary: '解读与企业和目标市场有关的真实信号', level: 'query', prompt: '请结合当前企业资料、主推产品、目标市场，并检索核验行业与平台公开原文，整理今天最值得关注的资讯。每条说明来源、与本企业的关系、机会或风险及建议动作；没有可靠来源时明确说明，不要编造资讯。' },
    { id: 'OP-03', label: '经营策略', summary: '判断经营重点并给出有依据的行动建议', level: 'plan', prompt: '请基于当前企业资料、主推产品、目标市场、本周任务、内容表现、询盘和投放数据，判断目前最重要的经营问题，并给出按优先级排列的策略建议。区分事实、推断和建议，说明依据、预期结果、风险与下一步；不要自动执行。' },
    { id: 'OP-04', label: '数据分析', summary: '分析内容、客户和投放数据中的变化与异常', level: 'query', prompt: '请读取当前账号可访问的真实经营数据，按内容、账号、发布、询盘、客户和投放维度分析关键变化、异常、可能原因和可行动建议。注明统计口径与时间范围；数据不足时明确缺口。对话中先给摘要，完整图表引导到对应分析页面。' },
    { id: 'OP-05', label: '今天优先做什么', summary: '从目标、任务和阻塞中选出三件要事', level: 'plan', prompt: '请结合本周目标、当前任务状态、阻塞项和最近回执，为我列出今天最值得完成的 3 项工作。每项说明优先级原因、所需输入、预计产出和依赖；不要自动启动任务。' },
    { id: 'OP-06', label: '检查经营健康度', summary: '检查账号、内容、询盘、客户和投放状态', level: 'query', prompt: '请检查当前企业的账号连接、内容供给、发布节奏、询盘处理、客户跟进和投放状态，按“正常、需关注、阻塞”分类，并给出最小修复动作。只引用真实状态，不把缺失数据当作正常。' },
    { id: 'OP-07', label: '复盘本周经营', summary: '复盘本周结果并识别有效与无效动作', level: 'query', prompt: '请基于本周真实任务、内容发布、互动、询盘、客户和投放结果做复盘，说明完成情况、有效动作、无效动作、未决风险和下周应保留或调整的策略。没有回执的任务单独列为待核验。' },
    { id: 'OP-08', label: '规划下一轮动作', summary: '形成下一轮最小可验证经营方案', level: 'plan', prompt: '请根据当前经营数据和本周复盘，提出下一轮最小可验证行动方案，包含目标、对象、步骤、负责人建议、衡量指标、依赖和停止条件。先输出计划摘要，等待我确认后再进入具体任务。' },
    { id: 'OP-09', label: '行业资讯', summary: '筛选目标行业的市场、技术和供应链信号', level: 'query', prompt: '请结合当前企业所属行业、主推产品和目标市场，检索并核验公开原文，整理今天最值得关注的行业资讯，包括市场变化、技术趋势、供应链动态和主要竞争动向。每条注明来源与时间、与本企业的关系、机会或风险和建议动作；没有可靠来源时明确说明，不要编造资讯。' },
    { id: 'OP-11', label: '社交媒体资讯', summary: '分析目标平台上的内容趋势和用户信号', level: 'query', prompt: '请结合当前企业、主推产品、目标市场和目标平台，检索并核验平台官方动态与公开内容，整理今天值得关注的内容趋势、热门话题、用户需求和对标账号变化。每条注明平台、来源与时间、适配原因、可尝试的内容方向和风险；不要把未核验热度写成事实。' },
    { id: 'OP-LEADER', label: '重点企业解读', summary: '从财报原文拆解龙头经营变化与后续观察点', level: 'query', prompt: '请解读华熙生物2026年半年度报告，拆解整体经营、原料与终端业务、技术产品和海外布局，区分公司披露与分析推断，说明对美妆原料企业的含义，并列出后续验证点。财务数字引用原表，未取得的季度数据和市场预期不要补造。' },
    { id: 'OP-12', label: '政策与平台资讯', summary: '识别影响出海经营的政策和平台规则变化', level: 'query', prompt: '请结合当前企业的目标市场、销售渠道和已连接平台，检索并核验公开原文，整理今天可能影响经营的政策、合规、贸易和平台规则变化。逐条注明来源与生效时间、影响范围、需核验事项和建议动作；无法确认最新状态时明确标记待核验，不要给出无依据的合规结论。' },
  ]),
  ...defineGroup('operations', [
    { id: 'OP-RATES', label: '查询参考汇率', summary: '选择币种，查询每日参考汇率及数据日期', level: 'query', prompt: '请查询美元兑人民币的最新每日参考汇率，标注数据日期、信息来源和参考口径，给出总体结论；实际结算采用银行可成交报价，不修改企业报价。' },
    { id: 'OP-TRADE', label: '查询国家贸易数据', summary: '选择国家、年份、方向与HS编码查询年度贸易金额', level: 'query', prompt: '请先确认统计国家、年份、进口或出口方向与产品HS编码，再查询该范围的年度贸易金额，标注数据来源与统计口径，并给出总体结论；不要猜测产品编码。' },
  ]),
  ...defineGroup('inspiration', [
    { id: 'IN-01', label: '最近哪些趋势可用', summary: '筛选适合产品和目标市场的可追溯趋势', level: 'query', prompt: '请读取系统内现有且可追溯的行业、平台和社媒趋势，结合我的企业、主推产品与目标市场，筛选最值得使用的趋势。逐条说明来源、适配原因、内容切入点、风险和有效期；不要把未经核验的信息写成事实。' },
    { id: 'IN-02', label: '分析当前对标内容', summary: '拆解对标内容并提炼可复用原则', level: 'query', prompt: '请分析当前已选中的对标账号或对标内容，从开头钩子、叙事结构、画面、卖点、互动设计和转化路径拆解其做法，并给出适合本企业的可复用原则。不要直接复制原文或虚构未读取的数据；未选对象时先让我选择。' },
    { id: 'IN-03', label: '筛选目标市场爆款', summary: '从现有爆款库筛选最相关的参考内容', level: 'query', prompt: '请从系统内已有爆款视频和对标内容中，筛选与我的主推产品、目标市场和目标平台最相关的内容。给出筛选依据、可借鉴元素、本地化建议和不适用之处，并保留原始来源。' },
    { id: 'IN-04', label: '拆解这条爆款内容', summary: '分析当前内容并形成不照搬的改编方向', level: 'plan', prompt: '请拆解当前选中的爆款内容，按受众、前三秒钩子、内容结构、视觉节奏、文案、互动与转化设计说明其有效原因，并提出一个不照搬原作、适合我方产品的改编方案。未选对象时先让我选择。' },
    { id: 'IN-05', label: '把灵感转成创作任务', summary: '补齐创作条件并准备待确认任务摘要', level: 'plan', prompt: '请把当前选中的灵感或素材整理成一个可执行的内容创作任务。先确认产品、目标、平台、时长或版式、数量和截止时间，再给出任务摘要；未经我确认不要创建或启动任务。' },
    { id: 'IN-06', label: '整理待拍清单', summary: '找出脚本和分镜仍缺少的拍摄素材', level: 'plan', prompt: '请结合当前创作任务、脚本、分镜和已有素材，整理仍需拍摄或补充的镜头、图片、口播、产品细节和授权材料。标明用途、规格、优先级及可替代素材，不要把缺失素材标记为已具备。' },
  ]),
  ...defineGroup('content', [
    { id: 'CO-HOOK', label: '选定一个开场', summary: '先选开场片段，再确认产品、内容方向和发布安排', level: 'plan', prompt: '我想先选一个吸引人的开场，再围绕它为产品策划一条视频，安排进周任务包。' },
    { id: 'CO-CAMPAIGN', label: '为活动准备内容', summary: '确认活动信息、产品与内容组合，再逐条安排发布时间', level: 'plan', prompt: '我想为一次活动准备内容，请帮我确认主题、产品和发布节奏，并安排进周任务包。' },
    { id: 'CO-REPLICATE', label: '借鉴一个爆款视频', summary: '确认产品、参考和周安排，系统策划并检查制作条件', level: 'plan', prompt: '我想借鉴一条爆款视频，为自己的产品策划内容，并安排进周任务包。' },
    { id: 'CO-SPEECH-HIGHLIGHT', label: '提炼口播核心卖点', summary: '选择产品，提炼并确认回填用于口播的核心卖点', level: 'plan', prompt: '请先让我选择一个企业知识库产品，基于已有产品事实提炼一条便于口播表达的核心卖点，展示原卖点和可编辑候选；由我确认后回填该产品知识库。不要自动改写已确认口播、生成声音或启动视频制作。' },
    { id: 'CO-01', label: '写一条爆款视频脚本', summary: '根据产品、受众和平台准备完整短视频脚本', level: 'plan', prompt: '请为我的主推产品策划一条短视频脚本。先读取企业与产品资料，并确认目标平台、目标市场、受众、内容目标、时长和语言；然后输出标题、前三秒钩子、逐镜头口播与画面、字幕要点、行动号召和合规注意事项。资料不足时先提问，不要虚构产品功效。' },
    { id: 'CO-02', label: '帮我制作产品分镜', summary: '把已确认脚本转成可拍摄的镜头方案', level: 'plan', prompt: '请为当前产品和已确认脚本制作可拍摄的分镜方案。先确认平台、画幅、时长、出镜方式和已有素材；按镜号列出时长、画面、景别、动作、口播或字幕、所需素材和转场，并指出仍需补拍的内容。不要直接启动生成或付费制作。' },
    { id: 'CO-04', label: '规划本周内容', summary: '根据经营目标和素材制定一周内容计划', level: 'plan', prompt: '请根据本周经营目标、主推产品、目标平台、已有素材和发布能力，制定一份本周内容计划。包含每天的主题、内容形式、受众、核心卖点、素材需求、负责人建议、发布时间和衡量指标；先给计划摘要，未经确认不要创建任务或排期。' },
    { id: 'CO-05', label: '查看素材怎么用', summary: '分析所选素材的用途、组合和质量风险', level: 'query', prompt: '请分析当前已选择的素材及其真实元数据，说明每份素材适合的产品、平台、内容位置和使用方式，并给出可组合的内容方案。指出清晰度、比例、版权或信息缺失问题；不要声称看过未成功读取的素材。' },
    { id: 'CO-06', label: '下一条做什么内容', summary: '从表现、目标和库存中推荐下一条内容', level: 'plan', prompt: '请结合最近内容表现、当前目标、主推产品、素材库存和发布节奏，推荐下一条最值得制作的内容。说明推荐依据、核心创意、所需素材、预计工作量和成功指标；不要自动创建任务。' },
    { id: 'CO-07', label: '改写成多平台版本', summary: '按不同平台规范改写当前脚本或内容', level: 'plan', prompt: '请将当前选中的脚本或内容改写为目标平台对应版本。保留事实与品牌口径，分别适配平台时长、画幅、语气、标题、标签和行动号召，并明确各版本差异。未选择源内容或平台时先询问。' },
    { id: 'CO-08', label: '优化前三秒钩子', summary: '为当前内容提供三个合规的钩子版本', level: 'plan', prompt: '请分析当前脚本或内容的前三秒，并给出 3 个与产品事实一致、适合目标受众和平台的钩子版本。每个版本说明吸引点、适用场景和后续承接方式；不要使用夸大、虚假或无法证明的承诺。' },
    { id: 'CO-09', label: '创建一组内容草稿', summary: '补齐范围后准备多条内容任务摘要', level: 'plan', prompt: '请为当前经营目标准备一组内容草稿。先确认产品、目标平台、目标市场、内容类型、数量、时长或版式、语言和截止时间，再输出各条内容的主题与任务摘要。未经确认不要创建任务，也不要启动生成、渲染或付费制作。' },
    { id: 'CO-10', label: '策划图片或海报', summary: '为目标平台准备图片或海报创作方案', level: 'plan', prompt: '请基于已确认的产品资料和当前素材，为目标平台策划图片或海报内容。先确认用途、平台、尺寸、语言、数量和视觉方向，再输出构图、文案层级、产品展示、行动号召及素材清单。不要自动生成图片或触发付费调用。' },
    { id: 'CO-11', label: '查看内容创作任务进度', summary: '读取真实任务回执，说明当前阶段和下一步', level: 'query', prompt: '查看我最近的内容创作任务进度，说明当前状态和下一步。请读取真实任务记录与回执；如有多条任务，先列出名称供我选择，不自动启动或修改任务。' },
    { id: 'CO-12', label: '审核内容并提出修改', summary: '审核当前结果并形成可执行修改清单', level: 'plan', prompt: '请审核当前选中的脚本、分镜、图片或视频结果，检查产品事实、品牌口径、平台适配、清晰度、字幕、行动号召和合规风险，并给出可执行的修改清单。未读取到结果时明确说明；未经确认不要接受结果或发起重做。' },
    { id: 'CO-13', label: '借鉴一个爆款图文', summary: '选择参考图与企业产品，一次生成图片和配文', level: 'navigation', prompt: '请帮我复刻一张图文海报。先选择参考图和企业产品，再确认核心卖点、目标受众、发布平台、画幅、语言与客户行动。使用企业真实素材和已确认事实重新创作，确认后生成图片与帖子配文。' },
  ]),
  ...defineGroup('publishing', [
    { id: 'PU-01', label: '规划本周发布安排', summary: '根据内容、账号和时区准备排期草案', level: 'plan', prompt: '请结合本周内容计划、已完成内容、已授权账号和目标市场时区，提出本周发布安排。列出平台、账号、内容、建议时间、文案准备状态和依赖；先给排期草案，未经确认不要创建或修改发布计划。' },
    { id: 'PU-02', label: '判断最佳发布时间', summary: '用真实历史表现判断建议发布时间', level: 'query', prompt: '请基于当前账号可用的真实历史表现、受众时区和内容类型，给出建议发布时间及依据。数据不足时说明采用的通用假设及不确定性，不要伪造最佳时段。' },
    { id: 'PU-03', label: '检查发布文案', summary: '审核标题、标签、首评和追踪链接', level: 'plan', prompt: '请审核当前待发布内容的标题、正文、标签、首评和追踪链接，检查平台适配、品牌口径、产品事实、链接完整性和合规风险，并给出修改稿。不要自动保存或发布；未选内容时先让我选择。' },
    { id: 'PU-04', label: '检查账号表现', summary: '按平台和账号分析真实表现与异常', level: 'query', prompt: '请读取当前已连接账号的真实表现，按平台和账号总结内容产出、触达、互动、增长、异常和可执行建议，并注明时间范围与统计口径。连接异常或数据缺失时单独列出。' },
    { id: 'PU-05', label: '查看高意向评论', summary: '识别高意向互动并准备跟进建议', level: 'plan', prompt: '请从当前可访问的评论和互动中识别高意向信号，按意向原因、涉及产品、建议回复和跟进优先级整理。不要自动回复、发送私信或改变客户状态。' },
    { id: 'PU-06', label: '核对发布状态与回执', summary: '区分已发布、失败和结果未知', level: 'query', prompt: '请读取当前发布任务的真实状态和渠道回执，区分待发布、处理中、已发布、明确失败和结果未知。对结果未知的任务先给恢复或核验路径，不要重复发布。' },
  ]),
  ...defineGroup('ads', [
    { id: 'AD-01', label: '分析投放数据', summary: '分析投放效果、成本趋势与异常', level: 'query', prompt: '请读取当前可访问的真实投放数据，按账户、计划、广告组和素材分析消耗、触达、点击、转化、成本、趋势和异常。注明时间范围、币种、归因口径与数据缺口，并给出不涉及自动调价的建议。' },
    { id: 'AD-02', label: '创建一条新投流计划', summary: '通过对话确认目标、素材和预算，保存新计划', level: 'plan', prompt: '请带我通过对话创建一条新投流计划，先读取企业资料，一次确认一个必要信息，最后由我确认保存草稿。未确认前不保存，也不启动投放或产生付费请求。' },
    { id: 'AD-03', label: '推荐渠道与受众', summary: '基于证据推荐优先测试的渠道和受众', level: 'plan', prompt: '请根据产品、目标市场、客户画像、内容表现和现有渠道数据，推荐优先测试的投放渠道与受众。说明证据、假设、排除项、测试规模和风险；数据不足时先列出需补充信息。' },
    { id: 'AD-04', label: '规划预算与目标', summary: '给出分阶段预算、指标和停止条件', level: 'plan', prompt: '请根据当前目标和可访问的历史数据，给出分阶段预算与目标建议，列出币种、周期、核心指标、预警阈值、停止条件和不确定性。只做规划，不要修改预算、出价或启动投放。' },
    { id: 'AD-05', label: '筛选投放素材', summary: '从已批准素材中设计可衡量测试组合', level: 'plan', prompt: '请从当前已批准且可用于投放的素材中，按目标、受众、平台适配、历史表现和合规风险筛选测试组合，并说明每组的变量和衡量方法。不要使用未批准或状态不明的内容。' },
    { id: 'AD-06', label: '检查投放执行与风险', summary: '检查授权、审批、预算、异常与真实回执', level: 'sensitive', prompt: '请检查当前投放对象的授权、账户连接、素材审批、预算、状态、异常和最新回执，区分可继续、需确认、阻塞和结果未知。不要自动启动、暂停、调价或重复提交；如需执行，先展示真实对象和影响摘要。' },
  ]),
  ...defineGroup('customer', [
    { id: 'CS-01', label: '优先跟进谁', summary: '按意向、价值和失联风险排列客户', level: 'plan', prompt: '请读取当前可访问的询盘、会话、客户阶段、最近互动和待办，按紧急度、购买意向、预计价值和失联风险给出今日跟进优先级。每位客户说明依据与建议动作；不要自动发送消息或改变客户状态。' },
    { id: 'CS-02', label: '总结当前会话', summary: '提取需求、异议、承诺和下一步', level: 'query', prompt: '请总结当前选中客户的完整会话，提取客户身份、需求、产品兴趣、数量、预算、时间、异议、已承诺事项、待确认问题和下一步。区分客户原话、系统事实与推断；未选会话时先让我选择。' },
    { id: 'CS-03', label: '生成回复草稿', summary: '根据知识库和客服边界准备回复', level: 'plan', prompt: '请基于当前会话、企业知识库、产品事实和客服边界，为客户生成一份回复草稿。语气匹配客户语言和阶段，回答已知问题并明确待确认项；不要编造价格、库存、交期、认证或承诺，也不要自动发送。' },
    { id: 'CS-04', label: '翻译客户消息与回复', summary: '准确翻译并准备符合客户语气的草稿', level: 'plan', prompt: '请准确翻译当前选中的客户消息，并保留产品名、数量、单位、价格和专有名词；同时提供一份符合当前客户语气的目标语言回复草稿。标出有歧义或需人工确认的部分，不要自动发送。' },
    { id: 'CS-05', label: '筛选高质量询盘', summary: '用明确业务依据筛选高质量询盘', level: 'query', prompt: '请根据当前可访问的询盘信息，按需求明确度、产品匹配、采购规模、时间、地区和互动质量筛选高质量询盘。说明评分依据和信息缺口；不要仅凭国别、语言或主观印象判断。' },
    { id: 'CS-06', label: '准备报价信息', summary: '整理报价事实、缺失项和风险', level: 'sensitive', prompt: '请根据当前客户需求和已确认的企业价格规则，整理报价前所需信息、已有事实、缺失项、风险和一份待审核的报价摘要。不要虚构价格、运费、税费、库存或交期，也不要生成正式承诺或发送报价。' },
    { id: 'CS-07', label: '制定客户跟进计划', summary: '按客户阶段准备时间和沟通计划', level: 'plan', prompt: '请根据当前客户阶段、最近互动、未决问题和企业跟进规则，制定下一步跟进计划，包含目标、时间、渠道、信息重点、负责人建议和停止条件。先给计划，不要自动创建批次或发送消息。' },
    { id: 'CS-08', label: '整理老客唤醒批次', summary: '筛选适合唤醒的人群并准备话术框架', level: 'sensitive', prompt: '请从当前可访问的沉默客户中筛选适合唤醒的人群，说明筛选条件、排除条件、建议分组、沟通主题和风险，并生成待审核话术框架。未经确认不要创建批次或发送消息。' },
    { id: 'CS-09', label: '补全客户画像', summary: '从可追溯事实整理画像和待补信息', level: 'plan', prompt: '请根据当前客户的会话和已确认资料，整理客户画像字段、购买意向、关注点、异议、下一步和仍需询问的信息。只使用可追溯事实；建议新增或修改标签时先展示变更摘要，不要自动写入。' },
  ]),
  ...defineGroup('enterprise', [
    { id: 'EN-01', label: '检查企业资料缺口', summary: '识别缺失、过期和待核验的企业资料', level: 'navigation', prompt: '请检查当前企业、品牌、产品和市场资料，按“已确认、缺失、过期、待核验”分类，说明每项缺口会影响哪些内容、客服或投放能力，并给出优先补充顺序。不要把推断写入企业事实。' },
    { id: 'EN-02', label: '检查知识冲突', summary: '查找知识库中的冲突和重复内容', level: 'navigation', prompt: '请检查当前企业知识库中关于产品、价格、规格、认证、市场、品牌口径和客服规则的冲突或重复内容，列出来源、冲突点、影响和建议处理方式。不要自动覆盖任何资料。' },
    { id: 'EN-03', label: '核对产品事实', summary: '区分已确认、证据不足和冲突的产品信息', level: 'query', prompt: '请核对当前主推产品的名称、规格、成分或材质、功能、适用对象、认证、价格规则和禁用表述，区分已确认事实、证据不足和互相冲突的信息，并列出创作或客服前必须补齐的项目。' },
    { id: 'EN-04', label: '整理目标客户画像', summary: '从企业资料和历史业务数据形成客户画像', level: 'plan', prompt: '请基于企业资料、目标市场、历史询盘和已确认客户数据，整理目标客户画像，包括角色、场景、需求、决策因素、常见异议和内容偏好。注明证据来源与不确定项，不要推断敏感个人属性。' },
    { id: 'EN-05', label: '检查数字人制作准备', summary: '检查形象、声音、授权、脚本和素材状态', level: 'navigation', prompt: '请检查当前数字人或出镜制作所需的形象、声音、授权、语言、脚本、素材和任务状态，列出已就绪、缺失、待确认和风险项。不要自动克隆声音、生成数字人或触发付费制作。' },
    { id: 'EN-06', label: '检查客服回复边界', summary: '明确可回答、只建议和必须人工确认的范围', level: 'navigation', prompt: '请读取当前企业的客服口径、价格与承诺边界、升级规则和禁用表述，整理哪些问题可直接回答、哪些只能给建议、哪些必须人工确认。若规则缺失或冲突，请明确阻塞项，不要自行扩大权限。' },
    { id: 'PL-01', label: '检查平台连接状态', summary: '核对授权范围、同步状态和异常', level: 'navigation', prompt: '请检查当前账号可访问的平台与渠道连接状态、授权范围、最近同步、异常和缺失能力，按“可用、需重新授权、未连接、状态未知”分类，并给出对应处理入口。不要声称连接未实际验证的平台。' },
    { id: 'PL-02', label: '还需要接什么平台', summary: '按经营目标推荐仍需接入的平台', level: 'navigation', prompt: '请根据当前经营目标、目标市场、内容发布、客服和投放需求，以及已连接平台，推荐仍需接入的平台。说明业务价值、所需权限、依赖、风险和优先级；不要自动发起授权。' },
    { id: 'PL-03', label: '梳理 WhatsApp 接入步骤', summary: '列出接入条件、步骤、验证和常见阻塞', level: 'navigation', prompt: '请根据当前 WhatsApp 连接状态和系统既有接入流程，列出接入前置条件、所需账号与权限、操作步骤、验证方法和常见阻塞。授权与真实消息发送必须在专用设置页由用户完成。' },
    { id: 'PL-04', label: '梳理社媒账号授权', summary: '说明授权范围、同步检查和撤销方式', level: 'navigation', prompt: '请根据当前需接入的社媒平台和系统既有流程，列出账号授权、权限范围、回调验证、数据同步检查和撤销方式。不要在对话中索取密码、验证码或访问令牌，也不要自动发起 OAuth。' },
  ]),
];

export const ASSISTANT_HOME_QUICK_LAUNCHERS: AssistantHomeQuickLauncher[] = [
  { id: 'weekly-plan', label: '查看当前周计划', description: '查看本周任务、优先事项、复盘和下一轮动作', promptIds: ['OP-CALENDAR', 'OP-01', 'CO-11', 'OP-05', 'OP-07', 'OP-08'] },
  { id: 'external-news', label: '查看外部资讯', description: '查看行业、社媒和政策平台信号', promptIds: ['OP-02', 'OP-LEADER', 'OP-09', 'OP-11', 'OP-12', 'OP-RATES', 'OP-TRADE'] },
  { id: 'business-analysis', label: '分析经营数据', description: '分析经营、账号、投放和客户数据', promptIds: ['OP-04', 'OP-06', 'PU-04', 'AD-01', 'CS-05'] },
  { id: 'viral-script', label: '内容创作', description: '选择视频创作或图文爆款复刻场景', promptIds: ['CO-REPLICATE', 'CO-HOOK', 'CO-07', 'CO-13', 'CO-SPEECH-HIGHLIGHT'] },
  { id: 'customer-followup', label: '跟进重点客户', description: '查看今日优先客户并进入会话跟进', promptIds: ['CS-01'] },
  { id: 'traffic-optimization', label: '优化智能投流', description: '分析投放并准备新计划和优化方案', promptIds: ['AD-01', 'AD-02'] },
];

export const ASSISTANT_HOME_LEVEL_LABELS: Record<AssistantHomePromptLevel, string> = {
  query: '查询分析',
  plan: '准备方案',
  sensitive: '需确认执行',
  navigation: '页面办理',
};

export function assistantHomePromptById(id: string): AssistantHomePrompt | undefined {
  return ASSISTANT_HOME_PROMPTS.find(entry => entry.id === id);
}

function normalizedQuickTaskText(value: string): string {
  return value.trim().replace(/\r\n?/gu, '\n').replace(/[ \t]+/gu, ' ');
}

/** Presentation-only classification; it never authorizes a task or mutation. */
export function isAssistantHomeQuickTaskText(value: string): boolean {
  const text = normalizedQuickTaskText(value);
  if (!text) return false;
  if (/^(?:行业资讯：行业：.+，目标市场：.+|查询.+兑.+的最新参考汇率|查询\d{4}年.+HS\s*\d{2,6}(?:进口|出口)金额)/u.test(text)) return true;
  return ASSISTANT_HOME_PROMPTS.some(entry => {
    const prompt = normalizedQuickTaskText(entry.prompt);
    return text === prompt || text.startsWith(`${prompt}\n`) || text.endsWith(`\n${prompt}`);
  });
}
