import type { Message } from '../../App';
import type { AssistantFileIntent } from '../../../shared/assistantFileIntent';
import { renderAssistantConversationBoundary, selectAssistantConversationContext } from '../../lib/assistantConversationContext';
import { ASSISTANT_NOTIFICATION_POLICY, ASSISTANT_RESPONSE_CONTRACT } from '../../lib/assistantGuides';
import { assistantBusinessObjectContext, type AssistantContext } from './globalAssistantRuntime';

export type UploadedAssistantAttachment = {
  name: string;
  size: number;
  kind: 'image' | 'video' | 'audio';
  materialId: string;
  materialUrl?: string;
};

export function buildAssistantChatMessages(input: {
  historyForApi: Message[];
  conversationContext: ReturnType<typeof selectAssistantConversationContext>;
  strategyRequest: boolean;
  visibleText: string;
  context: AssistantContext;
  enterpriseBrief: string;
  liveIntegrationFacts: string;
  uploadedAttachments: UploadedAssistantAttachment[];
  fileIntent: AssistantFileIntent | null;
  now: Date;
}): Message[] {
  const {
    historyForApi, conversationContext, strategyRequest, visibleText, context,
    enterpriseBrief, liveIntegrationFacts, uploadedAttachments, fileIntent, now,
  } = input;
  const apiMessages: Message[] = [
    ...historyForApi,
    {
      role: 'user',
      // The strategy route builds authoritative tenant grounding and policy
      // on the server. Frontend navigation hints must not claim that role.
      content: strategyRequest ? visibleText : [
        `【当前页面导航提示】${context.summary}`,
        `【当前模块】${context.label}`,
        assistantBusinessObjectContext(context),
        `【当前时间】${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）。未注明年份时，“当前/最新/近期/今年”均指当前年份；不得把 2024 年或更早的公开数据表述为当前数据。`,
        enterpriseBrief ? `【企业中心摘要】${enterpriseBrief}` : '【企业中心摘要】当前未读取到企业中心资料。',
        `【实时接入事实】\n${liveIntegrationFacts}`,
        uploadedAttachments.length
          ? [
            '【本次附件】以下文件已通过真实“我的素材”上传接口完成租户内持久化：',
            ...uploadedAttachments.map(item => `- ${item.name}｜${item.kind}｜${item.size} bytes｜material:${item.materialId}${item.materialUrl ? `｜${item.materialUrl}` : ''}`),
            '【附件事实边界】本轮只确认文件名、类型、大小、素材编号和链接；除非下游能力真实读取并返回证据，否则不得声称已经看见、听见或分析附件内容。',
          ].join('\n')
          : '',
        '【经营事实要求】描述、脚本、卖点、市场、客户、MOQ、价格、交期、认证、联系方式和语种，只能使用企业中心摘要、用户明确输入或当前页面真实素材证据。语种必须沿用企业中心主要业务语言/首选输出语言，禁止根据地区自行推断。没有来源的经营细节直接省略，不要用示例补齐。',
        '【联网要求】涉及外贸行业趋势、目标市场、平台规则、竞品或品类机会时，请联网检索公开来源，并在回答中保留可核验来源；不要把假设当成事实。',
        '【连续对话要求】承接已提供的对话和真实数据。证据不足或过期时，直接说明哪些结论无法确认，并给出可执行的核验步骤；区分事实、建议与待确认事项，禁止编造完成状态或数字。',
        renderAssistantConversationBoundary(conversationContext),
        `【回答与操作规范】\n${ASSISTANT_RESPONSE_CONTRACT}\n${ASSISTANT_NOTIFICATION_POLICY}`,
        `用户问题：${visibleText}`,
      ].join('\n'),
    },
  ];
  if (fileIntent) {
    apiMessages[apiMessages.length - 1].content += `\n【本轮交付格式】用户明确要求${fileIntent.format.toUpperCase()}文件。你仅整理将进入文件的正文，系统随后实际渲染并提供下载。不要声称文件已经生成，不要提供下载链接，不要教用户自行复制导出。正文使用清晰标题、短段落，可完整展开所需双语内容；已知事实、建议、待确认条件分开，不编造日期、承诺或客户数据。${fileIntent.diagram ? '这是业务路线图：按真实先后顺序组织阶段、行动和交付结果，不冒充地理地图。' : ''}`;
  }
  return apiMessages;
}
