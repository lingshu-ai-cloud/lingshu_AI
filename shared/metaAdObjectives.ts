/** Campaign objectives and result definitions are shared by UI, validation and readback. */
export const META_AD_GOALS = ['提升网站访问', '提升有效视频观看', '获取消息会话', '获取Meta表单线索', '获取独立站询盘'] as const;
export type MetaAdGoal = typeof META_AD_GOALS[number];
export type MetaMessageDestination = 'WHATSAPP' | 'MESSENGER' | 'INSTAGRAM_DIRECT';
export type MetaLeadConfiguration = { messageDestination?: MetaMessageDestination; whatsappPhoneNumber?: string; instagramActorId?: string; leadFormId?: string; pixelId?: string };
export const isMetaLeadGoal = (goal: string) => META_AD_GOALS.slice(2).includes(goal as MetaAdGoal);
export function metaAdObjective(goal: string | boolean, destination?: MetaMessageDestination) {
  if (goal === true || goal === '提升有效视频观看') return { objective: 'OUTCOME_ENGAGEMENT', optimizationGoal: 'THRUPLAY', destinationType: 'ON_VIDEO', metric: 'video_view', metricLabel: 'Meta ThruPlay', definition: 'meta:thruplay' };
  if (goal === false || goal === '提升网站访问') return { objective: 'OUTCOME_TRAFFIC', optimizationGoal: 'LINK_CLICKS', destinationType: 'WEBSITE', metric: 'inline_link_clicks', metricLabel: '链接点击', definition: 'meta:inline_link_clicks' };
  if (goal === '获取消息会话') return { objective: 'OUTCOME_ENGAGEMENT', optimizationGoal: 'CONVERSATIONS', destinationType: destination || 'WHATSAPP', metric: 'onsite_conversion.messaging_conversation_started_7d', metricLabel: '发起消息会话', definition: 'meta:messaging_conversation_started_7d' };
  if (goal === '获取Meta表单线索') return { objective: 'OUTCOME_LEADS', optimizationGoal: 'LEAD_GENERATION', destinationType: 'ON_AD', metric: 'onsite_conversion.lead_grouped', metricLabel: 'Meta 表单线索', definition: 'meta:instant_form_lead' };
  if (goal === '获取独立站询盘') return { objective: 'OUTCOME_LEADS', optimizationGoal: 'OFFSITE_CONVERSIONS', destinationType: 'WEBSITE', metric: 'offsite_conversion.fb_pixel_lead', metricLabel: '独立站 Lead 事件', definition: 'meta:pixel_lead' };
  throw new Error('不支持的 Meta 广告目标');
}

export const META_LEAD_DESCRIPTIONS: Record<string, string> = {
  '获取消息会话': '互动 → 消息应用 → 发起会话。选择客户通过哪个聊天渠道联系你；系统读取主页已关联的接收账号。会话不等于有效询盘或成交。',
  '获取Meta表单线索': '潜在客户 → 即时表单。确认表单业务内容；系统关联主页下已有的有效表单，不填写编号。',
  '获取独立站询盘': '潜在客户 → 网站 → Lead 事件。确认询盘页面；系统读取账户网站数据源。成功提交与 Lead 回传仍需实际验证。',
};
