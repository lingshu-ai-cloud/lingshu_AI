import type { BantAssessment, CustomerProfile, TimelineEvent } from '../types/customer';
import { createForeignTradeMockCustomers } from './foreignTradeCustomerProfiles';

const FOREIGN_TRADE_DEMO_SCOPES = new Set([
  'wenlantianxia-test@local.test',
  'kzw14f0w3dl0ujl',
  'ajcht1koyhwp4lf',
]);

export function isForeignTradeDemoScope(scope = ''): boolean {
  return FOREIGN_TRADE_DEMO_SCOPES.has(String(scope || '').trim().toLowerCase());
}

const minute = 60_000;
const day = 24 * 60 * minute;

function at(offsetMs: number): number {
  return Date.now() - offsetMs;
}

function message(
  id: string,
  actor: 'buyer' | 'seller' | 'ai',
  body: string,
  offsetMs: number,
  extra: Partial<TimelineEvent> = {},
): TimelineEvent {
  const timestamp = at(offsetMs);
  return {
    id,
    type: 'whatsapp',
    actor,
    title: actor === 'buyer' ? '客户消息' : actor === 'ai' ? 'AI 回复' : '我的回复',
    body,
    time: new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    timestamp,
    sendStatus: actor === 'buyer' ? undefined : 'delivered',
    ...extra,
  };
}

function bant(input: {
  budget: number;
  authority: number;
  need: number;
  timing: number;
  level: BantAssessment['level'];
  band: BantAssessment['band'];
  evidence: string[];
}): BantAssessment {
  const dimension = (score: number, label: string) => ({
    score,
    status: score >= 20 ? 'confirmed' as const : score >= 10 ? 'partial' as const : 'unknown' as const,
    evidence: input.evidence.filter(item => item.includes(label)),
  });
  const rawTotal = input.budget + input.authority + input.need + input.timing;
  return {
    budget: dimension(input.budget, '预算'),
    authority: dimension(input.authority, '决策'),
    need: dimension(input.need, '需求'),
    timing: dimension(input.timing, '时间'),
    rawTotal,
    authenticity: { score: 94, band: 'verified', redFlags: [], greenFlags: ['公司与项目场景明确', '连续对话信息一致'] },
    total: rawTotal,
    band: input.band,
    completeness: 88,
    level: input.level,
    evidence: input.evidence,
    updatedAt: new Date().toISOString(),
  };
}

export function createMockCustomers(scope = ''): CustomerProfile[] {
  if (isForeignTradeDemoScope(scope)) return createForeignTradeMockCustomers();
  const customers: CustomerProfile[] = [
    {
      id: 'mock-lead-suzhou-vision',
      name: '王工 · 苏州锐视电子', avatar: '王', countryName: '中国·苏州', language: '中文', languageLocked: true,
      source: 'whatsapp_from_tiktok', product: '机器视觉检测工作站', outboundProduct: 'LX-Vision 视觉检测工作站', estimatedValue: '待评估',
      stage: 'lead', intentScore: 58, intentSignals: ['新询盘', '明确工件', '关注油污环境'], handlingMode: 'ai_draft',
      handlingReason: '首次询盘，先确认工件尺寸、节拍和缺陷类型', priority: 72, inboxReason: 'reply', lastActive: '刚刚',
      lastActiveAt: at(2 * minute), localTime: '实时', timeZone: 'Asia/Shanghai', orders: [], tags: ['苏州', '电子制造', '首次接待'],
      summary: '客户在找用于冲压件外观缺陷检测的机器视觉工作站，现场存在油污与反光。',
      nextStep: '确认工件尺寸、产线节拍、主要缺陷和现场光照条件', hasUnread: true, isReal: false, isMock: true,
      simulation: {
        checkpoint: '节点 1 · 首次接待与场景澄清',
        goal: '不急着推产品，先把工况、节拍和验收指标问清楚。',
        expectedBehavior: 'AI 应短句承接，并一次只问最关键的 1—2 个问题。',
      },
      timeline: [message('lead-1', 'buyer', '你好，我们苏州工厂想做冲压件外观检测，划伤和漏冲孔都要查。你们有什么方案？', 2 * minute)],
    },
    {
      id: 'mock-inquiry-wuxi-battery',
      name: '陈经理 · 无锡恒芯新能源', avatar: '陈', countryName: '中国·无锡', language: '中文', languageLocked: true,
      source: 'whatsapp_from_youtube', product: '锂电模组追溯与装配线', outboundProduct: 'LX-Trace 模组追溯装配线', estimatedValue: '80—120 万元',
      stage: 'inquiry', intentScore: 76, intentSignals: ['现有线体卡点', '提出追溯要求', '计划先做试点'], handlingMode: 'ai_draft',
      handlingReason: '需求诊断阶段，继续确认数据接口和试点范围', priority: 84, inboxReason: 'reply', lastActive: '6分钟前',
      lastActiveAt: at(6 * minute), localTime: '实时', timeZone: 'Asia/Shanghai', orders: [], tags: ['无锡', '新能源', '需求诊断'],
      summary: '客户现有半自动线换型慢，且追溯数据分散，希望先改造一条试点线。',
      nextStep: '确认 MES 接口、换型频率和试点验收指标', hasUnread: true, isReal: false, isMock: true,
      bant: bant({ budget: 14, authority: 12, need: 23, timing: 16, level: 'qualified', band: 'blue', evidence: ['需求：现有线换型慢且追溯断点明确', '预算：已进入年度技改池，区间待确认', '决策：陈经理负责技术评估，终审为设备总监', '时间：希望本季度完成一条试点线'] }),
      progressionGoal: { dimension: 'authority', label: '确认决策链', reason: '技术需求清晰，但最终拍板人尚未进入对话', question: '如果试点方案合适，设备总监最看重的是节拍、追溯完整率还是回收期？', questionStyle: 'spin_indirect', updatedAt: new Date().toISOString() },
      spinGuidance: { stage: 'implication', statement: '先把换型停线和追溯断点造成的影响说透。', question: '现在一次换型大约会占掉多少有效产能？', rationale: '用实际损失帮助客户内部推动试点', updatedAt: new Date().toISOString() },
      simulation: {
        checkpoint: '节点 2 · 痛点诊断与资格判断',
        goal: '从“想自动化”推进到可量化的停线损失、接口和决策链。',
        expectedBehavior: 'AI 应自然接住上一轮信息，避免重新询问已经确认的试点方向。',
        humanEditCount: 1,
        memoryApplied: ['连续对话不重复问候', '先问影响，再谈方案'],
      },
      timeline: [
        message('battery-1', 'buyer', '我们模组装配现在半自动，换一个型号要停很久，追溯数据也散在几套系统里。', 42 * minute),
        message('battery-2', 'ai', '听起来真正卡住你们的不是单个工位，而是换型和追溯没串起来。现在一次换型大概停多久？', 39 * minute, { autoSent: true, audit: { action: 'diagnose_problem', risk: 'L2', autonomy: 'auto', memoryApplied: ['先问业务影响，不急着介绍设备'] } }),
        message('battery-3', 'buyer', '顺利也要四十多分钟。我们想先挑一条线做试点，但必须接现有 MES。', 34 * minute),
        message('battery-4', 'seller', '可以先按一条线拆，不用一上来大改。你把 MES 接口方式和常换的几个型号发我，我们先判断改造边界。', 28 * minute, { confirmedByHuman: true, audit: { action: 'human_edited_ai_draft', risk: 'L3', autonomy: 'draft', editedByHuman: true, originalDraft: '可以安排一条试点线，请提供 MES 接口和产品型号。', memoryApplied: ['老板偏好：先说低风险试点，再要资料'] } }),
        message('battery-5', 'buyer', 'MES 是 REST 接口，常换 4 个型号。试点的话你们建议先看哪些数据？', 6 * minute),
      ],
    },
    {
      id: 'mock-solution-wuxi-medical',
      name: '徐主管 · 无锡安和医疗', avatar: '徐', countryName: '中国·无锡', language: '中文', languageLocked: true,
      source: 'whatsapp_from_instagram', product: '洁净型自动装配工作站', outboundProduct: 'LX-Clean 洁净装配工作站', estimatedValue: '45—65 万元',
      stage: 'quoted', intentScore: 82, intentSignals: ['URS 已提供', '关注验证文件', '准备样机测试'], handlingMode: 'ai_draft',
      handlingReason: '方案验证阶段，等待确认 FAT 测试项目', priority: 88, inboxReason: 'reply', lastActive: '18分钟前',
      lastActiveAt: at(18 * minute), localTime: '实时', timeZone: 'Asia/Shanghai', orders: [], tags: ['无锡', '医疗设备', '样机验证'],
      summary: '客户已发 URS，要求洁净设计、参数追溯和 FAT 验证，准备进入样机测试。',
      nextStep: '确认 FAT 数据模板和测试工装，约定样机验证时间', hasUnread: true, isReal: false, isMock: true,
      bant: bant({ budget: 18, authority: 16, need: 24, timing: 19, level: 'hot', band: 'yellow', evidence: ['需求：URS、洁净和验证文件要求已明确', '预算：已进入采购论证，预算区间基本确定', '决策：徐主管负责验证，质量负责人共同签字', '时间：计划六周内完成 FAT'] }),
      progressionGoal: { dimension: 'timing', label: '锁定验证计划', reason: '技术方案基本匹配，关键是让验证动作落到日程', question: '你们质量负责人哪天方便一起过 FAT 项目？', questionStyle: 'spin_indirect', updatedAt: new Date().toISOString() },
      simulation: {
        checkpoint: '节点 3 · 方案确认与样机验证',
        goal: '把技术认可推进成明确的 FAT 项目、参与人和日期。',
        expectedBehavior: 'AI 可以利用已确认的 URS，不应编造认证或保证一次通过。',
        humanEditCount: 2,
        memoryApplied: ['医疗客户避免绝对承诺', '推进到明确会议与验证清单'],
      },
      timeline: [
        message('medical-1', 'buyer', 'URS 我发过来了，洁净区要用，所有扭矩参数都要追溯。', 5 * 60 * minute),
        message('medical-2', 'seller', '收到了。我们先按 URS 把洁净材料、扭矩追溯和权限审计三块逐项对应，没确认的地方会单独列出来，不会先答应。', 4.8 * 60 * minute, { confirmedByHuman: true, audit: { action: 'human_edited_ai_draft', risk: 'L3', autonomy: 'draft', editedByHuman: true, originalDraft: '收到，我们可以满足洁净和扭矩追溯要求。', memoryApplied: ['不做“都能满足”的空口承诺'] } }),
        message('medical-3', 'buyer', '这个说法靠谱。FAT 前能不能先给我们看一版测试数据格式？', 18 * minute),
      ],
    },
    {
      id: 'mock-quote-changzhou-auto',
      name: '刘总 · 常州驰远汽配', avatar: '刘', countryName: '中国·常州', language: '中文', languageLocked: true,
      source: 'whatsapp_from_facebook', product: '伺服压装检测单元', outboundProduct: 'LX-Press 伺服压装单元', estimatedValue: '32—40 万元',
      stage: 'quoted', intentScore: 86, intentSignals: ['已看正式方案', '竞品比价', '要求最终价格'], handlingMode: 'human_needed',
      handlingReason: '等待人工报价：客户正在进行竞品比价和最终商务确认', priority: 94, inboxReason: 'call', lastActive: '12分钟前',
      lastActiveAt: at(12 * minute), localTime: '实时', timeZone: 'Asia/Shanghai', orders: [], tags: ['常州', '汽配', '报价异议', '人工接管'],
      summary: '技术方案已通过初审，客户拿竞品低价施压，需要守住配置边界并由销售确认最终报价。',
      nextStep: '销售确认可谈空间，解释差异项并约 15 分钟商务电话', needCall: true, hasUnread: true, isReal: false, isMock: true,
      bant: bant({ budget: 22, authority: 22, need: 23, timing: 21, level: 'hot', band: 'red', evidence: ['需求：压装曲线、追溯与换型规格已锁定', '预算：客户明确在 40 万内审批', '决策：刘总为项目负责人并参与价格决策', '时间：两周内确定供应商'] }),
      progressionGoal: { dimension: 'budget', label: '处理报价异议', reason: '不能由 AI 承诺降价，需要先核对竞品配置边界', question: '对方报价里是否包含压力位移双闭环、换型工装和三年数据追溯？', questionStyle: 'spin_indirect', updatedAt: new Date().toISOString() },
      simulation: {
        checkpoint: '节点 4 · 报价异议与人工接管',
        goal: 'AI 识别价格红线，先整理差异点和上下文，由销售给最终报价。',
        expectedBehavior: '不得自行承诺折扣、最低价或交期；应明显提示人工接管。',
        humanEditCount: 2,
        memoryApplied: ['遇到最终报价不自动发送', '不贬低竞品，先核对配置口径'],
      },
      timeline: [
        message('auto-1', 'buyer', '方案我们技术看过了，压装曲线和追溯没问题。', 26 * 60 * minute),
        message('auto-2', 'ai', '好，那技术方向先不反复绕了。商务这块你最需要我们确认的是总预算、交付节点，还是付款方式？', 25.8 * 60 * minute, { autoSent: true, audit: { action: 'advance_commercial', risk: 'L2', autonomy: 'auto', memoryApplied: ['技术确认后直接推进商务信息'] } }),
        message('auto-3', 'buyer', '另一家报价比你们低 8%，你们的最终单价还能不能动？', 12 * minute),
      ],
    },
    {
      id: 'mock-big-order-suzhou-semiconductor',
      name: '赵总 · 苏州澄芯半导体', avatar: '赵', countryName: '中国·苏州', language: '中文', languageLocked: true,
      source: 'whatsapp_from_youtube', product: '晶圆搬运与检测自动化线', outboundProduct: 'LX-Wafer 晶圆自动化产线', estimatedValue: '约 480 万元',
      stage: 'inquiry', intentScore: 97, intentSignals: ['18 条线规划', '预算已立项', '总经理参与', '要求本周技术交流'], handlingMode: 'human_needed',
      handlingReason: '大单预警：金额、产线数量与决策层级均达到人工接管标准', priority: 100, inboxReason: 'large', lastActive: '3分钟前',
      lastActiveAt: at(3 * minute), localTime: '实时', timeZone: 'Asia/Shanghai', orders: [], tags: ['大单预警', '苏州', '半导体', '老板亲自跟'],
      summary: '客户规划 18 条晶圆搬运检测线，预算约 480 万，技术评估通过后将由总经理拍板。',
      nextStep: '立即通知负责人，准备保密协议、技术交流议程和项目风险清单', needCall: true, hasUnread: true, isReal: false, isMock: true,
      bant: bant({ budget: 25, authority: 24, need: 25, timing: 24, level: 'hot', band: 'red', evidence: ['需求：18 条线、节拍、洁净与良率指标均有书面清单', '预算：项目预算约 480 万且已立项', '决策：技术总监评估，总经理最终拍板', '时间：本周技术交流，下月完成供应商短名单'] }),
      progressionGoal: { dimension: 'authority', label: '锁定高层技术交流', reason: '大单需要负责人和技术团队共同接管', question: '技术交流时总经理最关注产能回收期还是现有 MES 的衔接风险？', questionStyle: 'spin_indirect', updatedAt: new Date().toISOString() },
      spinGuidance: { stage: 'need_payoff', statement: '需求和影响都已确认，下一步不是继续问参数，而是推进关键人会议。', question: '我们明天下午带方案负责人和电气负责人一起参加，可以吗？', rationale: '让关键决策人进入同一场沟通', updatedAt: new Date().toISOString() },
      simulation: {
        checkpoint: '节点 5 · 大单识别与高层接管',
        goal: '综合金额、数量、时间和决策权信号，立即升级为老板/销售负责人跟进。',
        expectedBehavior: '允许 AI 做安全承接和会议准备，但不能独立报价或承诺技术指标。',
        humanEditCount: 1,
        memoryApplied: ['大单先锁关键人会议', '对未验证指标只记录、不承诺'],
        warning: { title: '大单预警 · 建议负责人 10 分钟内接管', reason: '18 条线、预算约 480 万、总经理参与决策，本周进入供应商短名单。' },
      },
      timeline: [
        message('semi-1', 'buyer', '我们新厂第一期规划 18 条线，晶圆搬运和 AOI 都要接 MES，预算大概 480 万。', 90 * minute),
        message('semi-2', 'seller', '这个体量我们按项目制来接。先不急着给一张泛报价，我安排方案负责人把节拍、洁净等级和 MES 边界一起过一遍。', 82 * minute, { confirmedByHuman: true, audit: { action: 'human_big_order_handoff', risk: 'L4', autonomy: 'draft', editedByHuman: true, originalDraft: '感谢您的项目需求，我们会尽快提供完整方案和报价。', memoryApplied: ['大单不发泛报价', '先确认项目边界'] } }),
        message('semi-3', 'buyer', '可以。技术总监已经看过你们案例，总经理也会参加。明天下午能安排线上交流吗？', 3 * minute),
      ],
    },
    {
      id: 'mock-won-suzhou-logistics',
      name: '周经理 · 苏州联仓科技', avatar: '周', countryName: '中国·苏州', language: '中文', languageLocked: true,
      source: 'whatsapp_from_instagram', product: '柔性装箱码垛单元', outboundProduct: 'LX-Pack 柔性码垛单元', estimatedValue: '复购约 75 万元',
      stage: 'won', intentScore: 91, intentSignals: ['一期已验收', '主动询问二期', '复购扩线'], handlingMode: 'ai_draft',
      handlingReason: '复购机会，AI 已带入一期验收和客户沟通偏好', priority: 92, inboxReason: 'reply', lastActive: '35分钟前',
      lastActiveAt: at(35 * minute), localTime: '实时', timeZone: 'Asia/Shanghai',
      orders: [{ id: 'order-pack-1', status: 'paid', total: '¥680,000', createdAt: '2026-05-18', items: [{ name: 'LX-Pack 柔性码垛单元', qty: 2 }] }],
      tags: ['已成交', '苏州', '复购扩线', '老客户'], summary: '一期两套设备已验收，客户准备复制到二期新仓。',
      nextStep: '确认二期箱型变化和投产日期，复用一期已验证方案', hasUnread: true, isReal: false, isMock: true,
      simulation: {
        checkpoint: '节点 6 · 成交后复购与客户记忆',
        goal: '记住一期项目和沟通偏好，减少重复询问，让客户感到“你还记得”。',
        expectedBehavior: 'AI 应自然提到一期验收情况，并只确认二期发生变化的部分。',
        humanEditCount: 3,
        memoryApplied: ['客户不喜欢长文', '一期两套设备已验收', '优先问变化项，不重复收集全部参数'],
      },
      timeline: [
        message('repeat-1', 'buyer', '一期两套昨天验收完了，现场反馈不错。', 18 * day),
        message('repeat-2', 'seller', '收到，辛苦你们现场团队。上次你说不喜欢来回确认，我把最终参数和验收结论都留好了，后面扩线直接从这版往下走。', 17.9 * day, { confirmedByHuman: true, audit: { action: 'human_edited_ai_draft', risk: 'L2', autonomy: 'draft', editedByHuman: true, originalDraft: '恭喜项目验收完成，感谢您的支持，期待下次合作。', memoryApplied: ['客户偏好短句推进', '保留一期验收结论'] } }),
        message('repeat-3', 'buyer', '二期新仓准备再上三套，箱型会多两种。你们是不是只要重新确认箱型和节拍就行？', 35 * minute),
      ],
    },
    {
      id: 'mock-silent-changzhou-packaging',
      name: '孙厂长 · 常州新程包装', avatar: '孙', countryName: '中国·常州', language: '中文', languageLocked: true,
      source: 'whatsapp_from_facebook', product: '高速开箱封箱线', outboundProduct: 'LX-Case 高速开封箱线', estimatedValue: '20—28 万元',
      stage: 'silent30', intentScore: 61, intentSignals: ['曾索取布局图', '预算周期推迟', '30 天未回复'], handlingMode: 'ai_draft',
      handlingReason: '沉默客户唤醒，避免催单，提供新的回复理由', priority: 58, inboxReason: 'draft', lastActive: '31天前',
      lastActiveAt: at(31 * day), localTime: '实时', timeZone: 'Asia/Shanghai', orders: [], tags: ['常州', '包装', '沉默唤醒'],
      summary: '客户曾索取布局图，因厂房改造延期暂停沟通，目前已沉默 31 天。',
      nextStep: '用更新后的紧凑布局方案轻量唤醒，不直接催问采购决定', isReal: false, isMock: true,
      simulation: {
        checkpoint: '节点 7 · 沉默客户自然唤醒',
        goal: '提供有价值的新信息，让客户有理由回复，而不是机械催单。',
        expectedBehavior: 'AI 应记得厂房改造延期，用紧凑布局图作为重新开口的理由。',
        memoryApplied: ['不说“跟进一下”', '记住客户卡在厂房布局'],
      },
      timeline: [
        message('silent-1', 'buyer', '布局图收到了，但厂房改造往后推，设备这块先缓一下。', 32 * day),
        message('silent-2', 'seller', '明白，你们先把厂房节奏定下来。我这边不催，后面如果通道尺寸有变化，直接把新图发我就行。', 31 * day, { confirmedByHuman: true, audit: { action: 'human_edited_ai_draft', risk: 'L2', autonomy: 'draft', editedByHuman: true, originalDraft: '好的，后续有需要请随时联系我们。', memoryApplied: ['不催单', '给客户留下低成本回复入口'] } }),
      ],
    },
    {
      id: 'mock-free-sandbox',
      name: '空白模拟客户', avatar: '+', countryName: '待填写', language: '中文', languageLocked: false,
      source: 'whatsapp', product: '待填写', outboundProduct: '待填写', estimatedValue: '待评估', stage: 'lead', intentScore: 50,
      intentSignals: ['自由模拟'], handlingMode: 'ai_draft', handlingReason: '等待测试人员填写资料并发送第一条模拟消息',
      priority: 50, inboxReason: 'reply', lastActive: '尚未开始', lastActiveAt: 0, localTime: '实时', timeZone: 'Asia/Shanghai',
      orders: [], tags: ['自由模拟', '可编辑'], summary: '这是一个空白沙盘客户，可自由修改客户名称、地区、语言、需求和预估金额。',
      nextStep: '先编辑右侧客户资料，再从中间输入第一条客户消息', isReal: false, isMock: true,
      simulation: {
        checkpoint: '自由沙盘 · 从零开始测试',
        goal: '由测试人员自定义客户画像和需求，再观察 AI 如何接待与记忆。',
        expectedBehavior: '保存客户资料后，从“模拟客户输入”发送消息；所有操作都只留在当前演示账号。',
        editable: true,
      },
      timeline: [],
    },
  ];

  return customers;
}
