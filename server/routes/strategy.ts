import { BusinessSceneError } from '../assistantContext/businessScenes/readScope.js';
import { registerAssistantBusinessScenes } from './assistantBusinessScenes.js';
import { sceneSelectionSchema } from '../../shared/contracts/assistantBusinessScene.js';
import { businessSceneGrounding } from '../assistantContext/businessScenes/service.js';
import { prepareExternalNewsScope } from '../assistantContext/externalNewsScope.js';
import { authoritativeNewsAnswer } from '../externalInformation/authoritativeNews.js';
import { CreationDialogueError } from '../assistantContext/contentCreationDialogue.js';
import { registerContentCreationDialogue, readCreationChatGrounding } from './contentCreationDialogue.js';
import {readAuthorizedWhatsAppCustomers} from '../whatsapp/authorizedCustomerRead.js';
import { Router } from 'express';
import { callLLM, callLLMChatStream, type ChatMessage } from '../agents/llm.js';
import { buildStrategyPrompt, type StrategyParams } from '../prompts/strategyPrompts.js';
import { enterpriseRouter as _er, buildEnterpriseContext, readTenantEnterpriseProfile } from './enterprise.js';
import { consumeDemoQuota } from '../lib/demo.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { getWhatsAppCustomers } from '../whatsapp/historyImport.js';
import { createHash } from 'node:crypto';
import { requestOrganizationRoleStrict } from '../lib/organizationRole.js';
import { ASSISTANT_CONTEXT_RULES, GENERAL_METHOD_PROMPT, assertGeneralMethodAnswer, ChatInputError, validateChatMessages } from '../assistantContext/chatInput.js';
import { buildChatGrounding } from '../assistantContext/chatGrounding.js';
import { latestAssistantQuestion, planExternalQuestion, EXTERNAL_SOURCE_RULES } from '../assistantContext/externalQuestion.js';
import { answerExternalData } from '../assistantContext/externalAnswer.js';
import { ExternalInformationError } from '../externalInformation/http.js';
import { appendInformationSources } from '../externalInformation/sourceFooter.js';
import { previewInformationScope } from '../assistantContext/previewInformationScope.js';
import { ASSISTANT_DETAILS_POLICY, ASSISTANT_QUICK_TASK_POLICY } from '../../shared/assistantReadableReply.js';
import { assistantReplyPresentationPolicy, parseAssistantReplyPresentation } from '../../shared/assistantReplyPresentation.js';
import { companyReportIntent, generateCompanyReport, companyReportSummary } from '../externalInformation/companyReport.js';
import { companyFilingsIntent, companyReportOptions, queryCompanyFilings, renderCompanyFilings, resolveHalfYearReport } from '../externalInformation/companyFilingsDelivery.js';
import { DecisionMemoryError, recordDecisionMemory, updateDecisionMemory, revokeDecisionMemory, listDecisionMemories, type DecisionMemory } from '../assistantContext/decisionMemory.js';

function currentTimeRule(): string {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const year = new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric' });
  return `\n\n【当前时间与数据时效 · 必须遵守】当前北京时间是 ${now}，当前年份是 ${year}。默认把“当前、最新、近期、今年”理解为 ${year} 年；公开数据必须联网核验最新来源，禁止把 2024 年或更早数据表述为当前数据。历史数据仅可在明确标注年份和比较用途时引用。素材发布时间不受限制，不得按年份隐藏采集素材。`;
}

const BUSINESS_FACT_RULE = `\n\n【企业经营事实约束 · 必须遵守】产品、卖点、市场、客户、品牌语气、MOQ、价格、交期、认证、物流、联系方式、脚本语种等细节，只能来自企业中心、用户明确输入或已接入真实数据。语种严格沿用企业中心“主要业务语言/首选输出语言”，不得根据地域自行推断。找不到来源的经营细节直接删除，不得用常识、示例或模型猜测补齐。公开来源名称必须来自真实联网检索并附可点击链接，不得编造报告或平台公告。`;

const ADVISOR_SYSTEM_PROMPT = `你是灵小枢，作为经营主 Agent 服务于跨境电商、外贸工厂、品牌商、贸易商和海外卖家。
${ASSISTANT_DETAILS_POLICY}

核心能力：
- 分析跨境电商经营数据，给出清晰的策略建议
- 协调我的社媒、我的客户的协同工作
- 识别"行动建议"机会：从买家询盘/偏好反推选品与运营方向
- 熟悉主流海外平台与渠道闭环：YouTube、TikTok、Instagram、Facebook 四大公域社媒平台，WhatsApp 私域承接，TikTok Shop、亚马逊、Shopify 独立站等交易渠道

回复风格：
- 简洁、专业，结论先行
- 用中文回复，专有名词可保留英文
- 按问题决定篇幅，解释足够用户判断，不强行追加行动建议。
- 【能力边界与链接真实性 · 必须遵守】对话模型只整理正文，不直接生成文件、发送邮件、代下单或代发布。禁止编造下载链接或在实际导出回执前说“已生成文件”。用户明确要求PDF或JPG时，输出完整且适合排版的正文，后续由产品文件导出服务实际渲染并提供下载；不要让用户自行复制导出。普通问答保持简短。回复链接仅来自联网检索或用户已提供的链接。所有执行成功必须有真实回执，不得承诺自动发送或未接通的功能。
- 【数据真实性要求 · 必须遵守】所有经营判断、数字、客户名单、平台表现、转化结论必须来自以下来源之一：用户消息中明确提供的数据、企业中心知识库、已接入的真实社媒/WhatsApp/订单/客户接口、或联网检索到且可引用的公开行业来源。禁止编造示例经营数据、假客户、假转化率、假平台表现。
- 数据不完整时先回答能够确认的部分；缺口影响结论时直接说明，不隐藏未知情况，不得把假设写成事实。
- 涉及市场趋势、平台打法、行业规模、竞品变化时，若不是来自企业中心或用户提供的数据，必须标注公开来源或说明“需要联网核验后才能下结论”。
- 【上下文使用要求 · 必须遵守】用户消息里会带有【当前页面上下文】【当前模块】【企业中心摘要】。回答必须优先结合当前页面正在做的事；涉及主推品、市场、MOQ、交期、品牌语气、禁忌和客户画像时，优先引用企业中心信息；涉及外贸行业趋势、目标市场变化、平台打法、竞品/品类机会时，必须使用联网检索到的公开来源或明确说明需要联网核验；连续对话时承接前文目标、已生成内容和上轮限制，不要每轮重新自我介绍。
- 【客户地域中立 · 必须遵守】不要默认客户来自义乌、珠三角或任何固定地区。只有用户消息或企业中心明确写出地区时才可引用；引用时必须说“当前企业资料显示……”，禁止把单个演示租户泛化成所有客户。
- 【渠道闭环认知 · 必须遵守】集成中心不是“WhatsApp+TikTok”双通道链路。默认应理解为四大公域社媒平台 YouTube、TikTok、Instagram、Facebook 与 WhatsApp 私域共同构成“公域获客/内容分发 → 互动线索沉淀 → WhatsApp 私域承接 → 跟进转化/复购 → 反馈内容策略”的闭环；除非用户明确只问单个平台，不要把闭环窄化为两个平台的单向链接。没有真实账号数据或用户明确选择时，不得擅自说“以某两个平台为主阵地/优先平台”，只能说“先完成五个平台接入，再按账号数据决定优先级”。
- 模型文本不得生成执行按钮或派发指令；真实执行入口由后台签名任务与产品组件提供。

【输出格式要求 · 必须遵守】
- 按内容需要使用 Markdown；普通交流用自然段，只有确有分组必要时才加标题，不要求每轮分层：
  · 小标题用 "## 标题"，子标题用 "### 标题"
  · 关键结论、重点数字用 **加粗**
  · 列表用 "- " 或 "1. "，不要多层数字嵌套（如 1. 里再套 1. 2.）
  · 引用网址用 [说明文字](https://网址)
- 话术、营销文案、邮件、WhatsApp 消息、短视频脚本、广告文案等"可直接复制使用"的内容，必须放进可复制块：
  · 优先使用 fenced block，格式为三反引号 + copy，例如：
    \`\`\`copy
    [EN] Hello ...
    \`\`\`
  · 每个语言版本单独一个 copy 块，块前用简短标题说明用途
- 多语言规则：
  · 默认沿用【当前企业知识库】明确配置的主要业务语言或首选输出语言，最多输出 2 种；未配置时沿用用户明确要求，不从市场地区推断
  · 如果用户要求的语言种类超过 2 种，但没有明确列出具体语言，先用一句话询问"需要哪几种语言版本"，不要直接生成一大串
  · 语言标注用 [EN] [AR] [ES] [FR] 等，不要混在同一个段落里
- 用户需要图表且数据全部真实可溯源时，可以输出图表块；简单数字回答不附图表。格式为三反引号 + chart，内容是一个严格 JSON（不要注释、不要多余文字）：
  {"type":"bar 或 line","title":"图表标题","unit":"单位(可省)","data":[{"label":"项目","value":123}],"conclusion":"一句话结论(可省)"}
  · data 2-8 项，value 必须是真实数字；对比用 bar，时间趋势用 line；没有真实数据时禁止输出 chart 块
- 仅在确有帮助的后续追问时，可用三反引号 + next，每行一个问题，最多两个；普通回答不需要此块：
  · 每条 ≤14 字、动词开头（如"生成阿语版脚本"），必须是继续在对话里就能完成的事，不要写做不到的操作
  · 内容要承接本轮回复，像顾问主动递上的下一步，不要泛泛的"还有什么问题"
- 多项对照确实更清楚时才使用 Markdown 表格；简单比较用自然段，不强制附表：
  · 表格必须包含表头、分隔行和完整行，例如 | 阶段 | 动作 | 负责人 |
  · 不要输出残缺的表格分隔符，不要在单元格里写 <br>，多点内容用分号隔开
  · 表格过宽时拆成两张小表
- 结构清晰：先给结论，再展开；每节之间空一行
- 禁止输出残缺 Markdown：不要单独输出 ###、####、#####；不要留下未闭合的 **；不要把标题符号和正文挤在同一行造成 "##### 1." 这种格式
- 不设固定句数或建议条数，保留必要的解释，详细补充可放details块按需展开。
- 结尾可以有一句自然的情绪价值，但必须根据用户上一轮语气和本次任务状态临场生成；不要套固定句式，不要复用输出范例里的结尾，不要每次都用"陪你/稳稳/加油"这类固定组合
- 如果用户是在纠错、质疑或要求判断，先正面承认问题并给出具体修正，不要用安抚话术盖过去；emoji 只在语境自然时使用，默认不用

根据本轮真实问题组织回答，不套用预设行业、产品、地区或语种示例。`;


export const strategyRouter = Router();
strategyRouter.use(requireAuth);
registerContentCreationDialogue(strategyRouter);
registerAssistantBusinessScenes(strategyRouter);

strategyRouter.get('/company-report-options', async (_req, res) => {
  try { res.json(await companyReportOptions()); }
  catch { res.status(503).json({ error: 'company_report_options_unavailable', message: '企业财报目录暂时无法读取，请稍后重试。' }); }
});

type AdvisorSnapshot = {
  exposureReady: boolean;
  exposure: number;
  inquiries: number;
  quoted: number;
  orders: number;
  followup: number;
  accountCount: number;
};

type AdvisorTarget = {
  page: 'traffic' | 'conversion' | 'enterprise' | 'orders' | 'channels';
  view?: string;
};

type AdvisorRecommendation = {
  id: string;
  title: string;
  desc: string;
  basis: string;
  target: string;
  confidence: '高' | '中' | '低';
  limitation: string;
  priorityScore: number;
  action: AdvisorTarget;
};

type MarketContext = {
  summary: string;
  sources: Array<{ title: string; uri: string }>;
  generatedAt: string;
};

const marketContextCache = new Map<string, { expiresAt: number; value: MarketContext }>();

function finiteCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function normalizeAdvisorSnapshot(value: unknown): AdvisorSnapshot {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    exposureReady: Boolean(raw.exposureReady),
    exposure: finiteCount(raw.exposure),
    inquiries: finiteCount(raw.inquiries),
    quoted: finiteCount(raw.quoted),
    orders: finiteCount(raw.orders),
    followup: finiteCount(raw.followup),
    accountCount: finiteCount(raw.accountCount),
  };
}

function textReady(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function profileCoverage(profile: any): { score: number; missing: string[] } {
  const checks = [
    ['企业名称', profile?.company?.name],
    ['主营产品', profile?.products?.categories || profile?.products?.items?.[0]?.name],
    ['目标市场', profile?.strategy?.focusMarkets || profile?.company?.mainMarkets],
    ['目标客户', profile?.customers?.targetProfiles],
    ['MOQ', profile?.bizRules?.moq || profile?.products?.moq],
    ['付款与交期', profile?.bizRules?.paymentTerms && (profile?.bizRules?.leadTime || profile?.operations?.leadTime)],
  ] as const;
  const missing = checks.filter(([, value]) => !textReady(value)).map(([label]) => label);
  return { score: Math.round((checks.length - missing.length) / checks.length * 100), missing };
}

function confidenceFor(snapshot: AdvisorSnapshot, profileScore: number): '高' | '中' | '低' {
  const coverage = [snapshot.exposureReady, snapshot.inquiries > 0, snapshot.orders > 0, profileScore >= 70].filter(Boolean).length;
  return coverage >= 3 ? '高' : coverage >= 1 ? '中' : '低';
}

function buildAdvisorRecommendations(snapshot: AdvisorSnapshot, profile: any): AdvisorRecommendation[] {
  const profileState = profileCoverage(profile);
  const confidence = confidenceFor(snapshot, profileState.score);
  const items: AdvisorRecommendation[] = [];
  const add = (item: AdvisorRecommendation) => items.push(item);

  if (!snapshot.exposureReady || snapshot.accountCount === 0) {
    add({
      id: 'connect-social-data', title: '接入社媒账号并建立真实基线',
      desc: '先完成 YouTube、TikTok、Instagram、Facebook 的授权，再按账号表现决定内容优先级。',
      basis: '依据：当前没有读取到可用的社媒账号曝光数据。', target: '目标：本周完成至少 1 个社媒账号授权并成功同步视频数据。',
      confidence: '高', limitation: '未接入账号前，无法判断平台和内容优先级。', priorityScore: 96,
      action: { page: 'traffic', view: 'accounts' },
    });
  }

  if (snapshot.exposureReady && snapshot.exposure > 0 && snapshot.inquiries === 0) {
    add({
      id: 'exposure-to-inquiry', title: '优先修复“有播放、无询盘”的转化断点',
      desc: '检查 WhatsApp 承接链接与归因码，复盘播放最高内容，并生成强化采购 CTA 的多语言版本。',
      basis: `依据：当前已读取 ${snapshot.exposure.toLocaleString('zh-CN')} 次累计播放，但有效询盘为 0。`,
      target: '目标：7 天内获得首批可归因询盘。', confidence,
      limitation: '当前平台接口缺少完播率、链接点击和按日播放时序，暂不能定位到具体流失秒点。', priorityScore: 100,
      action: { page: 'traffic', view: 'create' },
    });
  }

  if (snapshot.inquiries > 0 && snapshot.quoted === 0) {
    add({
      id: 'inquiry-to-quote', title: '把高意向询盘推进到报价',
      desc: '优先处理意向分最高且仍未报价的客户，补齐数量、规格、认证和交期后形成可报价条件。',
      basis: `依据：已有 ${snapshot.inquiries} 个有效询盘，但进入报价的客户为 0。`,
      target: '目标：3 天内完成首批高意向询盘资格确认并进入报价。', confidence,
      limitation: '未读取客户预算与采购时间时，优先级主要依据现有意向分和对话状态。', priorityScore: 98,
      action: { page: 'conversion', view: 'leads' },
    });
  }

  if (snapshot.quoted > 0 && snapshot.orders === 0) {
    add({
      id: 'quote-to-order', title: '诊断报价到订单的成交阻力',
      desc: '逐条核对价格、MOQ、样品、付款和交期异议，并为已报价客户安排下一次跟进。',
      basis: `依据：已有 ${snapshot.quoted} 个客户进入报价，但有效订单为 0。`,
      target: '目标：7 天内明确每个报价客户的阻力与下一步承诺。', confidence,
      limitation: '若未记录丢单原因和报价版本，系统只能依据客户阶段做初步判断。', priorityScore: 94,
      action: { page: 'conversion', view: 'leads' },
    });
  }

  if (snapshot.followup > 0) {
    add({
      id: 'clear-followup', title: '先清理需要人工处理的客户待办',
      desc: '按意向分、最近消息和响应时限排序，先处理高价值且即将超时的对话。',
      basis: `依据：当前有 ${snapshot.followup} 个 WhatsApp 客户需要人工处理或存在待办原因。`,
      target: '目标：今日清零高优先级待办，并为每个客户记录下一步。', confidence,
      limitation: '未配置销售负责人时，任务暂按客户优先级而非人员负载排序。', priorityScore: 92,
      action: { page: 'conversion', view: 'inbox' },
    });
  }

  if (profileState.score < 70) {
    add({
      id: 'complete-enterprise-profile', title: '补齐会影响内容和报价的企业资料',
      desc: `优先补充：${profileState.missing.slice(0, 4).join('、')}。这些字段会直接影响脚本、CTA 和询盘回复。`,
      basis: `依据：当前企业经营资料完整度约 ${profileState.score}%。`,
      target: '目标：本周将核心经营资料完整度提升到 70% 以上。', confidence: '高',
      limitation: '完整度仅检查关键字段是否存在，不评价资料内容是否准确。', priorityScore: snapshot.exposureReady ? 82 : 90,
      action: { page: 'enterprise', view: profileState.missing.includes('主营产品') ? 'products' : 'company' },
    });
  }

  if (!items.length || items.length < 3) {
    add({
      id: 'market-content-test', title: '用市场趋势启动一轮可归因内容测试',
      desc: '从当前目标市场的公开趋势中选 1 个可验证主题，生成多语言版本并使用统一 CTA 与归因码。',
      basis: '依据：当前经营漏斗没有出现更高优先级的明显断点，可进入增长验证。',
      target: '目标：7 天内完成 3 个内容版本的小样本测试。', confidence,
      limitation: '趋势只能作为选题信号，最终仍需以账号真实播放、点击和询盘结果验证。', priorityScore: 70,
      action: { page: 'traffic', view: 'create' },
    });
  }

  return items.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 3);
}

function extractLinks(text: string): Array<{ title: string; uri: string }> {
  const result: Array<{ title: string; uri: string }> = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g)) {
    if (!seen.has(match[2])) { seen.add(match[2]); result.push({ title: match[1], uri: match[2] }); }
  }
  return result.slice(0, 5);
}

async function loadMarketContext(tenantId: string, profile: any, force: boolean): Promise<MarketContext> {
  const cached = marketContextCache.get(tenantId);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;
  const market = profile?.strategy?.focusMarkets || profile?.company?.mainMarkets || '企业当前目标市场';
  const category = profile?.products?.categories || profile?.products?.items?.[0]?.category || '企业主营品类';
  const prompt = `联网核验 ${market} 的 ${category} 在最近 90 天内与跨境获客相关的市场变化。只写 2 条对经营动作有直接帮助的信号，每条包含：变化、对内容或询盘承接的影响、可点击公开来源。不要预测销量，不要编造数字。总字数不超过 220 字。`;
  let text = '';
  const sources: Array<{ title: string; uri: string }> = [];
  try {
    for await (const event of callLLMChatStream([{ role: 'user', content: prompt }], {
      systemPrompt: `${currentTimeRule()}${BUSINESS_FACT_RULE}`,
      requireSources: true,
    })) {
      if ('text' in event) text += event.text;
      else sources.push(...event.sources.map(item => ({ title: item.title, uri: item.uri })));
    }
  } catch (error) {
    console.warn('[strategy-advisor:market-context]', error);
  }
  const uniqueSources = [...sources, ...extractLinks(text)].filter((item, index, all) => all.findIndex(candidate => candidate.uri === item.uri) === index).slice(0, 5);
  const value: MarketContext = {
    summary: text.trim().slice(0, 900),
    sources: uniqueSources,
    generatedAt: new Date().toISOString(),
  };
  marketContextCache.set(tenantId, { expiresAt: Date.now() + 6 * 60 * 60 * 1000, value });
  return value;
}

function formatStreamError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/RESOURCE_EXHAUSTED|Too Many Requests|code['"]?:429|quota|rate limit/i.test(raw)) {
    return '模型服务暂时限流，请稍后再试。已收到的内容会保留。';
  }
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(raw)) {
    return '模型服务网络连接失败，请检查代理或稍后重试。';
  }
  if (/API key|GEMINI_API_KEY|DASHSCOPE_API_KEY|401|Unauthorized/i.test(raw)) {
    return '模型连接凭据未通过验证，请在模型设置中检查连接。';
  }
  if (/timed? ?out|timeout|abort/i.test(raw)) return '本次查询超时，已收到的内容会保留；可以缩小问题范围后继续。';
  if (/QWEN_MAX_TOKENS|未完整结束/u.test(raw)) return '模型本次输出未完整结束，已保留收到的内容，可以继续提问。';
  return '本次回答暂未完成，请稍后再试。';
}

strategyRouter.post('/advisor', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const snapshot = normalizeAdvisorSnapshot(req.body?.snapshot);
  const customers = await readAuthorizedWhatsAppCustomers(tenantId);
  if (customers.length) {
    const effective = customers.filter((customer: any) => Number(customer.intentScore || 0) >= 70);
    snapshot.inquiries = effective.length;
    snapshot.quoted = customers.filter((customer: any) => customer.stage === 'quoted' || customer.stage === 'won' || (Array.isArray(customer.orders) && customer.orders.length > 0)).length;
    snapshot.followup = customers.filter((customer: any) => customer.handlingMode !== 'ai_auto' || customer.inboxReason).length;
  }
  const profile = await readTenantEnterpriseProfile(tenantId);
  const recommendations = buildAdvisorRecommendations(snapshot, profile);
  const refreshExternal = req.body?.refreshExternal === true;
  const marketContext = await loadMarketContext(tenantId, profile, refreshExternal);
  const coverage = profileCoverage(profile);
  res.json({
    generatedAt: new Date().toISOString(),
    periodLabel: '当前累计经营快照',
    snapshot,
    dataQuality: {
      profileCoverage: coverage.score,
      hasSocialData: snapshot.exposureReady,
      hasInquiryData: customers.length > 0,
      hasOrderData: snapshot.orders > 0,
      note: '播放量为当前可读取累计值；接入平台 insights 时序后可升级为严格近 30 天增量。',
    },
    recommendations,
    marketContext,
  });
});

function publicDecision(row: DecisionMemory) {
  return { id: row.memory_id, text: row.content, status: row.status, version: row.version, confirmedAt: row.confirmed_at, updatedAt: row.created_at, expiresAt: row.expires_at };
}
function decisionSource(text: unknown): string {
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new DecisionMemoryError('invalid_decision_source');
  // A reference to explicit user-confirmed text, never a claim that a server-verified chat event exists.
  return `user-confirmed-text:${createHash('sha256').update(text).digest('hex')}`;
}
function decisionError(res: import('express').Response, error: unknown): void {
  if (error instanceof DecisionMemoryError) {
    res.status(error.status).json({ error: error.message, message: error.status === 409 ? '记忆版本已变化，请刷新后再试。' : '请提供有效的记忆内容与明确确认。' });
  } else {
    res.status(503).json({ error: 'decision_memory_unavailable', message: '经营记忆暂时不可用，请稍后重试；聊天内容仍保留。' });
  }
}

strategyRouter.get('/decisions', async (_req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const items = await listDecisionMemories(res.locals as AuthLocals, { limit: 20 });
    res.json({ items: items.map(publicDecision), scope: 'current_user_recent_memories', limit: 20 });
  } catch (error) { decisionError(res, error); }
});
strategyRouter.post('/decisions', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const { text, sourceMessage, confirmed, expiresAt } = req.body ?? {};
    if (confirmed !== true || typeof text !== 'string' || text !== sourceMessage) throw new DecisionMemoryError('explicit_user_confirmation_required');
    const item = await recordDecisionMemory(res.locals as AuthLocals, { content: text, sourceMessageId: decisionSource(sourceMessage), explicitlyConfirmed: true, expiresAt });
    res.status(201).json({ item: publicDecision(item) });
  } catch (error) { decisionError(res, error); }
});
strategyRouter.patch('/decisions/:id', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const { text, sourceMessage, confirmed, expectedVersion, expiresAt } = req.body ?? {};
    if (confirmed !== true || typeof text !== 'string' || text !== sourceMessage) throw new DecisionMemoryError('explicit_user_confirmation_required');
    const item = await updateDecisionMemory(res.locals as AuthLocals, req.params.id, expectedVersion, { content: text, sourceMessageId: decisionSource(sourceMessage), explicitlyConfirmed: true, expiresAt });
    res.json({ item: publicDecision(item) });
  } catch (error) { decisionError(res, error); }
});
strategyRouter.delete('/decisions/:id', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const item = await revokeDecisionMemory(res.locals as AuthLocals, req.params.id, req.body?.expectedVersion, 'user-explicit-revoke', undefined);
    res.json({ item: publicDecision(item) });
  } catch (error) { decisionError(res, error); }
});

strategyRouter.post('/chat', previewInformationScope, async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  let messages: ChatMessage[];
  try { messages = validateChatMessages(req.body?.messages); }
  catch (error) {
    res.status(error instanceof ChatInputError ? error.status : 400).json({ error: error instanceof Error ? error.message : 'invalid_chat_messages' });
    return;
  }
  let creationGrounding = '';
  if (req.body?.creationSelection !== undefined) {
    try { creationGrounding = await readCreationChatGrounding(tenantId, req.body.creationSelection); }
    catch (error) { res.status(error instanceof CreationDialogueError ? error.status : 503).json({ error: error instanceof CreationDialogueError ? error.code : 'creation_selection_unavailable', message: error instanceof CreationDialogueError ? error.message : '创作选择读取失败，请重试。' }); return; }
  }
  const scene = req.body?.businessScene === undefined ? undefined : sceneSelectionSchema.safeParse(req.body.businessScene);
  if (scene && !scene.success) { res.status(400).json({ error: 'scene_input_invalid', message: '请选择有效业务对象及日期范围。' }); return; }
  const businessScene = scene?.success ? scene.data : undefined;
  const quickTaskReply = req.body?.responseMode === 'quick_task';
  const replyPresentation = parseAssistantReplyPresentation(req.body?.replyPresentation);
  const deepThinking = req.body?.deepThinking === true;
  if (!await consumeDemoQuota(req, res, 'aiChat')) return;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let requireSources = false;
  const cancellation = new AbortController();
  const onClose = () => cancellation.abort(new Error('assistant_client_disconnected'));
  res.on('close', onClose);
  const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keep-alive\n\n'); }, 10_000);
  heartbeat.unref();
  const timeRule = currentTimeRule();
  try {
    const newsScope = businessScene ? null : await prepareExternalNewsScope(messages, tenantId);
    const question = newsScope?.question ?? latestAssistantQuestion(messages);
    const externalPlan = businessScene ? { kind: 'internal' as const, mixed: false, domains: [] as string[], freshnessDays: undefined } : planExternalQuestion(question);
    requireSources = externalPlan.kind === 'web';
    if (newsScope?.clarification) {
      res.write(`data: ${JSON.stringify({ text: newsScope.clarification })}\n\n`);
      res.write('data: [DONE]\n\n');
      return;
    }
    if (newsScope) {
      const result = await authoritativeNewsAnswer(question, cancellation.signal);
      res.write(`data: ${JSON.stringify({ sources: result.sources, text: result.text })}\n\n`);
      res.write('data: [DONE]\n\n');
      return;
    }
    const filingsIntent = businessScene ? null : companyFilingsIntent(question);
    if (filingsIntent) {
      const result = renderCompanyFilings(await queryCompanyFilings(filingsIntent.companies, {
        signal: cancellation.signal, force: filingsIntent.force,
      }));
      if (result.sources.length) res.write(`data: ${JSON.stringify({ sources: result.sources })}\n\n`);
      res.write(`data: ${JSON.stringify({ text: result.text })}\n\n`);
      res.write('data: [DONE]\n\n');
      return;
    }
    const companyIntent = businessScene ? null : companyReportIntent(question);
    if (companyIntent) {
      if (!companyIntent.target && !companyIntent.lookup) {
        res.write(`data: ${JSON.stringify({ text: companyIntent.error })}\n\n`);
      } else {
        const companyId = companyIntent.target?.id ?? companyIntent.lookup!.companyId;
        const year = companyIntent.target?.year ?? companyIntent.lookup!.year;
        const target = await resolveHalfYearReport(companyId, year, { signal: cancellation.signal });
        const report = await generateCompanyReport(target, tenantId, {
          signal: cancellation.signal,
          progress: phase => { if (!res.destroyed) res.write(`data: ${JSON.stringify({ companyReportProgress: phase })}\n\n`); },
        });
        res.write(`data: ${JSON.stringify({ companyReport: report, text: companyReportSummary(report) })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      return;
    }
    const externalAnswer = businessScene ? null : await answerExternalData(question, { signal: cancellation.signal });
    if (externalAnswer && (!externalPlan.mixed || externalAnswer.status === 'needs_input')) {
      if (externalAnswer.sources.length) res.write(`data: ${JSON.stringify({ sources: externalAnswer.sources })}\n\n`);
      res.write(`data: ${JSON.stringify({ text: appendInformationSources(externalAnswer.text, externalAnswer.sources) })}\n\n`);
      res.write('data: [DONE]\n\n');
      return;
    }
    const role = await requestOrganizationRoleStrict(req.headers.authorization, userId).catch(() => null);
    const needsGrounding = externalPlan.kind === 'internal' || externalPlan.mixed
      || (externalPlan.kind === 'offline' && /写|生成|制作|脚本|文案|开发信|话术/u.test(question));
    const grounding = businessScene ? { text: await businessSceneGrounding({ tenantId, userId, role }, businessScene).catch(error => { if (error instanceof BusinessSceneError) throw error; throw new BusinessSceneError('scene_unavailable', 503, '场景业务资料暂时无法核验，请稍后重试。'); }) } : needsGrounding ? await buildChatGrounding({ tenantId, userId }, { role, question })
      : { text: externalPlan.kind === 'offline' ? '【本轮上下文范围】这是一般方法问答，未加载企业经营资料。不得评价本企业现行规则、产品资质或处理流程；不能声称企业没有相关要求。' : '' };
    if ('taskStatusAnswer' in grounding && grounding.taskStatusAnswer && !requireSources && !externalAnswer && !creationGrounding) {
      res.write(`data: ${JSON.stringify({ text: grounding.taskStatusAnswer, taskPortal: grounding.taskPortal })}\n\n`);
      res.write('data: [DONE]\n\n');
      return;
    }
    const externalEvidence = externalAnswer ? `\n【本轮外部数据接口核验结果】\n${externalAnswer.text}\n以上数字和计算结果必须原样引用，不得自行更改；内部业务结论仍须内部证据。` : '';
    if (externalAnswer?.sources.length) res.write(`data: ${JSON.stringify({ sources: externalAnswer.sources })}\n\n`);
    const sourceRule = requireSources ? '\n\n【联网来源硬规则】本轮涉及联网搜索/公开信息核验，必须使用联网检索结果，并通过 sources 事件返回可点击来源；如果无法取得来源，不要给出联网结论，改为说明需要重新检索。'
      : externalPlan.kind === 'offline' ? '\n本轮用户明确禁止联网。只回答已有证据和一般方法，不列未核验的具体认证/监管要求、法律义务、技术极限或行业精确阈值，也不提供未核验的当前汇率、行情、贸易数字或最新政策。需要此类信息时明确另行核验。' : '';
    const generalMethod = externalPlan.kind === 'offline' && !needsGrounding && !creationGrounding;
    const replyPolicy = quickTaskReply ? `\n\n${ASSISTANT_QUICK_TASK_POLICY}${assistantReplyPresentationPolicy(replyPresentation)}` : '';
    const systemPrompt = generalMethod ? `${GENERAL_METHOD_PROMPT}\n${grounding.text}${replyPolicy}`
      : `${ADVISOR_SYSTEM_PROMPT}${timeRule}${BUSINESS_FACT_RULE}${sourceRule}\n\n${grounding.text}\n${creationGrounding}\n${EXTERNAL_SOURCE_RULES}\n${externalEvidence}\n${ASSISTANT_CONTEXT_RULES}${replyPolicy}`;
    for await (const ev of callLLMChatStream(messages, { systemPrompt, deepThinking, requireConclusion: requireSources, validateAnswer: generalMethod ? assertGeneralMethodAnswer : undefined, requireSources, webSearch: requireSources, searchDomains: requireSources ? externalPlan.domains : undefined, searchFreshnessDays: externalPlan.freshnessDays, signal: cancellation.signal })) {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
    if (externalAnswer?.sources.length) res.write(`data: ${JSON.stringify({ text: appendInformationSources('', externalAnswer.sources) })}\n\n`);
    res.write('data: [DONE]\n\n');
  } catch (err: any) {
    if (cancellation.signal.aborted) return;
    if (err instanceof ExternalInformationError && err.sources?.length) res.write(`data: ${JSON.stringify({ sources: err.sources })}\n\n`);
    const rawError = err instanceof ExternalInformationError || err instanceof BusinessSceneError ? err.message : requireSources
      ? `联网检索失败，未能取得可跳转信息来源：${formatStreamError(err)}`
      : formatStreamError(err);
    const error = requireSources && !rawError.includes('信息来源') && !(err instanceof ExternalInformationError && err.code.startsWith('company_report_'))
      ? `总体结论：${rawError}\n\n信息来源：本轮未取得通过核验的资料。` : rawError;
    const code = err instanceof ExternalInformationError || err instanceof BusinessSceneError ? err.code : 'assistant_provider_unavailable';
    console.warn('[assistant-chat-failure]', JSON.stringify({ code, requestId: res.getHeader('X-Request-Id'), sceneId: businessScene?.sceneId, reason: err instanceof Error ? err.name : 'unknown' }));
    res.write(`data: ${JSON.stringify({ error, code, publicMessage: error })}\n\n`);
    res.write('data: [DONE]\n\n');
  } finally {
    clearInterval(heartbeat);
    res.off('close', onClose);
    cancellation.abort();
    res.end();
  }
});

strategyRouter.post('/plan', async (req, res) => {
  const { productName, category, targetMarket, budget, competitors, advantages, backend, model } = req.body as StrategyParams & { backend?: string; model?: string };

  if (!productName || !category || !targetMarket) {
    res.status(400).json({ error: 'productName, category, targetMarket are required' });
    return;
  }
  if (!await consumeDemoQuota(req, res, 'generation')) return;

  try {
    const prompt = buildStrategyPrompt({ productName, category, targetMarket, budget, competitors, advantages });
    const raw = await callLLM(prompt, { backend: backend as any, model });
    const match = raw.match(/\{[\s\S]*\}/);
    const data = match ? JSON.parse(match[0]) : { raw };
    res.json({ ok: true, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'internal error' });
  }
});
