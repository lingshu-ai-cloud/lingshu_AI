/** Product implementation capabilities only; never substitutes account, release or authorization preflight. */
export const PLATFORM_AD_CAPABILITIES = [
  { provider: 'meta', name: 'Meta', channels: ['Facebook', 'Instagram'], goals: ['提升网站访问', '提升有效视频观看'], currencies: ['USD', 'CNY'], management: '人工、审批、授权托管；CPC 自动优化仅网站访问', material: '引用已有视频，或绑定社媒成片上传 MP4（≤64 MiB）；需平台处理就绪', actions: '暂停创建、启停、调整日预算' },
  { provider: 'tiktok', name: 'TikTok', channels: ['TikTok'], goals: ['提升有效视频观看'], currencies: ['USD'], management: '仅人工执行；审批与自动执行未开放', material: 'Spark：TT_USER 身份及既有可推广帖子', actions: '暂停创建、启停；不支持调预算' },
  { provider: 'google', name: 'Google / YouTube', channels: ['YouTube'], goals: ['获取线索或转化'], currencies: ['USD'], management: '仅人工执行；审批与自动执行未开放', material: 'Demand Gen；标准视频观看写入未开放', actions: '暂停创建、启停；不支持调预算' },
] as const;

export const PLATFORM_AD_GOALS = ['提升网站访问', '提升有效视频观看', '提升互动与主页增长', '扩大目标人群覆盖', '获取线索或转化'] as const;

export function getAdPlanCapability(plan: { channels: readonly string[]; goal: string; currency: string }) {
  const platform = PLATFORM_AD_CAPABILITIES.find(item => plan.channels.length > 0 && plan.channels.every(channel => (item.channels as readonly string[]).includes(channel)));
  const validChannels = !!platform && (platform.provider === 'meta' || plan.channels.length === 1);
  const supportsCreate = validChannels && (platform.goals as readonly string[]).includes(plan.goal) && (platform.currencies as readonly string[]).includes(plan.currency);
  const supportsManaged = supportsCreate && platform.provider === 'meta';
  const reason = !validChannels
    ? '仅用于规划：真实创建需按广告平台拆分计划，Meta 可同时选择 Facebook 和 Instagram；保存草稿仍需满足币种及表单校验。'
    : !(platform.currencies as readonly string[]).includes(plan.currency)
      ? `当前平台执行仅支持 ${platform.currencies.join(' / ')}，且须与账户币种一致。`
      : !supportsCreate
        ? `仅保存草稿：${platform.name} 当前执行目标为${platform.goals.join('、')}。`
        : `已实现此目标的创建流程；仍需账户、素材、预算与授权预检，尚未完成真实账户验收。${platform.management}。`;
  return { provider: validChannels ? platform.provider : null, supportsCreate, supportsManaged, supportsApproval: supportsManaged, supportsCpcOptimization: supportsManaged && plan.goal === '提升网站访问', reason };
}
