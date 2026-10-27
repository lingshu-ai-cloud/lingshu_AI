export const ASSISTANT_REPLY_PRESENTATION_KINDS = [
  'operations',
  'news',
  'analytics',
  'reference',
  'inspiration',
  'content',
  'publishing',
  'ads',
  'customer',
  'enterprise',
] as const;

export type AssistantReplyPresentationKind = typeof ASSISTANT_REPLY_PRESENTATION_KINDS[number];

export type AssistantReplyPresentationMeta = {
  detailLabel: string;
  showSources: boolean;
  prompt: string;
};

export const ASSISTANT_REPLY_PRESENTATIONS: Record<AssistantReplyPresentationKind, AssistantReplyPresentationMeta> = {
  operations: {
    detailLabel: '逐项任务与判断依据',
    showSources: false,
    prompt: '经营任务查询：可见正文只保留本周所处状态、完成概况、待处理概况、最多两个真正阻塞项和一个今天最优先动作，约 350～500 字。不要逐个罗列产品、任务、内部产品序号或技术报错；逐任务记录、产品清单、时间口径和次要依赖放 details。',
  },
  news: {
    detailLabel: '更多背景与来源',
    showSources: true,
    prompt: '资讯查询：按事件组织，而不是按固定“结论/原因/建议”组织。可见正文精选最多三件真正相关的事，每条给标题、来源与日期、和本企业的关系、机会或风险；来源链接紧邻事实。补充背景、检索范围和次要来源放 details。',
  },
  analytics: {
    detailLabel: '统计口径与逐项数据',
    showSources: false,
    prompt: '经营数据分析：可见正文只放最重要的三至五个指标变化、异常和业务影响，优先展示真实数字与比较基准。只有存在至少两个可比真实数值时才使用一个 chart 块；计算口径、完整明细和次要维度放 details。',
  },
  reference: {
    detailLabel: '数据口径与计算说明',
    showSources: true,
    prompt: '参考数据查询：可见正文直接给数值、数据日期、单位或币种、适用口径和一个关键限制，通常不超过四个信息点。来源靠近数值；计算过程、字段定义、完整表格和替代口径放 details。',
  },
  inspiration: {
    detailLabel: '更多拆解与原始来源',
    showSources: true,
    prompt: '灵感与对标查询：以可借鉴对象为单位，分别呈现钩子或做法、适配原因、不适用之处和来源；不要写成泛化趋势报告。最值得采用的方向留在可见正文，完整拆解放 details。',
  },
  content: {
    detailLabel: '制作明细与任务依据',
    showSources: false,
    prompt: '内容制作查询：可见正文按当前阶段说明已具备、缺少、卡点和下一步，优先点名具体内容或素材。逐镜、逐素材、历史回执和备选做法放 details；不可把失败或待确认藏起来。',
  },
  publishing: {
    detailLabel: '逐项回执与恢复路径',
    showSources: false,
    prompt: '发布与账号查询：按发布阶段或账号组织，清楚区分待发布、处理中、已发布、失败和结果未知。异常、影响和恢复动作留在可见正文；逐条渠道回执和统计口径放 details。',
  },
  ads: {
    detailLabel: '投放明细与归因口径',
    showSources: false,
    prompt: '投放查询：可见正文优先呈现消耗、效果、异常、风险和不涉及自动调价的建议；币种、周期和归因口径必须可见。广告组明细、完整指标和计算方式放 details。',
  },
  customer: {
    detailLabel: '会话依据与跟进明细',
    showSources: false,
    prompt: '客户查询：按客户或会话组织，突出意向信号、最近互动、未决问题和建议跟进动作；把事实与推断分开。完整消息摘录、评分口径和次要客户放 details；不得把建议写成已发送或已承诺。',
  },
  enterprise: {
    detailLabel: '资料清单与核验依据',
    showSources: false,
    prompt: '企业资料与连接查询：按已就绪、需关注、阻塞组织，说明缺口影响和最小补齐动作。具体字段清单、权限明细和核验记录放 details；未核验状态不能写成正常。',
  },
};

export function parseAssistantReplyPresentation(value: unknown): AssistantReplyPresentationKind | undefined {
  return typeof value === 'string' && (ASSISTANT_REPLY_PRESENTATION_KINDS as readonly string[]).includes(value)
    ? value as AssistantReplyPresentationKind
    : undefined;
}

export function assistantReplyPresentationPolicy(kind: AssistantReplyPresentationKind | undefined): string {
  return kind ? `\n【本轮信息呈现】${ASSISTANT_REPLY_PRESENTATIONS[kind].prompt}` : '';
}
