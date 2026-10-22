import { SocialPlatformIcon } from './SocialPlatformIcon';

export type AgentTaskGroup = 'social' | 'conversion' | 'customer';

export const AGENT_GROUPS: { id: AgentTaskGroup; label: string; desc: string }[] = [
  { id: 'conversion', label: '经营动态定时任务', desc: '报价、主要市场和行业情报' },
  { id: 'social', label: '我的社媒定时任务', desc: '内容采集、趋势监控、社媒素材分析' },
  { id: 'customer', label: '老客唤醒定时任务', desc: '老客分层、沉默唤醒、复购触达' },
];

export function taskAgentGroup(taskType: string): AgentTaskGroup {
  if (['social_discovery_collection', 'video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl', 'trend_report', 'holiday_push'].includes(taskType)) return 'social';
  if (['crm_wakeup'].includes(taskType)) return 'customer';
  return 'conversion';
}

export function nextDirectorCheckLabel(now = Date.now()): string {
  const interval = 15 * 60 * 1000;
  const next = new Date((Math.floor(now / interval) + 1) * interval);
  return next.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const TASK_TEMPLATES = [
  {
    templateId: 'instagram_video_keyword_crawl',
    taskType: 'video_keyword_crawl',
    name: 'Instagram 视频采集',
    category: 'daily' as const,
    cronExpr: '0 1 * * *',
    cronLabel: '每天 01:00（北京时间）',
    icon: '📸',
    desc: '定时采集 Instagram 关键词视频，并进入素材分析管线',
    config: { platforms: 'instagram', keywords: '', keywordSource: 'business_profile', limit: '5', dateWindowDays: '7' },
  },
  {
    templateId: 'instagram_image_post_crawl', taskType: 'image_post_crawl', name: 'Instagram 图文采集', category: 'daily' as const,
    cronExpr: '0 2 * * *', cronLabel: '每天 02:00（北京时间）', icon: '🖼️', desc: '定时采集 Instagram 关键词图片帖与图文内容',
    config: { platforms: 'instagram', keywords: '', keywordSource: 'business_profile', limit: '5' },
  },
  {
    templateId: 'facebook_image_post_crawl', taskType: 'image_post_crawl', name: 'Facebook 图文采集', category: 'daily' as const,
    cronExpr: '0 3 * * *', cronLabel: '每天 03:00（北京时间）', icon: '📘', desc: '定时采集 Facebook 关键词图片帖与图文内容',
    config: { platforms: 'facebook', keywords: '', keywordSource: 'business_profile', limit: '5' },
  },
  ...(['youtube', 'tiktok', 'facebook', 'instagram'] as const).map((platform, index) => ({
    templateId: `${platform}_competitor_account_crawl`,
    taskType: 'competitor_account_crawl',
    name: `${platform === 'youtube' ? 'YouTube' : platform === 'tiktok' ? 'TikTok' : platform === 'facebook' ? 'Facebook' : 'Instagram'} 对标账号采集`,
    category: 'daily' as const,
    cronExpr: `0 ${4 + index} * * *`,
    cronLabel: `每天 ${String(4 + index).padStart(2, '0')}:00（北京时间）`,
    icon: platform === 'youtube' ? '▶️' : platform === 'tiktok' ? '🎵' : platform === 'facebook' ? '📘' : '📸',
    desc: `定时采集已保存的${platform === 'youtube' ? ' YouTube' : platform === 'tiktok' ? ' TikTok' : platform === 'facebook' ? ' Facebook' : ' Instagram'} 对标账号最新内容`,
    config: { platforms: platform, limit: '10', dateWindowDays: '7' },
  })),
  {
    templateId: 'youtube_video_keyword_crawl',
    taskType: 'video_keyword_crawl',
    name: 'YouTube 热点视频采集',
    category: 'daily' as const,
    cronExpr: '0 1 * * *',
    cronLabel: '每天 01:00（北京时间）',
    icon: <SocialPlatformIcon platform="youtube" size={24} />,
    desc: '每天凌晨自动采集 YouTube 热点关键词视频，并排队获取真实视频 / Gemini 分析',
    config: { platforms: 'youtube', keywords: '', keywordSource: 'business_profile', limit: '5', dateWindowDays: '7' },
  },
  {
    templateId: 'tiktok_video_keyword_crawl',
    taskType: 'video_keyword_crawl',
    name: 'TikTok 热点视频采集',
    category: 'daily' as const,
    cronExpr: '0 1 * * *',
    cronLabel: '每天 01:00（北京时间）',
    icon: <SocialPlatformIcon platform="tiktok" size={24} />,
    desc: '每天凌晨自动采集 TikTok 热点关键词视频，并排队获取真实视频 / Gemini 分析',
    config: { platforms: 'tiktok', keywords: '', keywordSource: 'business_profile', limit: '5', dateWindowDays: '7' },
  },
  {
    templateId: 'facebook_video_keyword_crawl',
    taskType: 'video_keyword_crawl',
    name: 'Facebook 热点视频采集',
    category: 'daily' as const,
    cronExpr: '0 1 * * *',
    cronLabel: '每天 01:00（北京时间）',
    icon: <SocialPlatformIcon platform="facebook" size={24} />,
    desc: '每天凌晨自动采集 Facebook 热点关键词视频，并排队获取真实视频 / AI 分析',
    config: { platforms: 'facebook', keywords: '', keywordSource: 'business_profile', limit: '5', dateWindowDays: '7' },
  },
  { templateId: 'trend_report', taskType: 'trend_report', name: 'TikTok 爆款日报', category: 'daily' as const, cronExpr: '0 8 * * *', cronLabel: '每天 08:00', icon: <SocialPlatformIcon platform="tiktok" size={24} />, desc: '每日生成 TikTok 跨境电商热门趋势简报' },
  { templateId: 'exchange_rate', taskType: 'exchange_rate', name: '汇率与报价日报', category: 'daily' as const, cronExpr: '0 9 * * *', cronLabel: '每天 09:00', icon: '💱', desc: '按企业主要市场刷新汇率，并结合价格区间、MOQ 和毛利规则给出报价提醒' },
  { templateId: 'market_intelligence', taskType: 'market_intelligence', name: '主要市场行业周报', category: 'report' as const, cronExpr: '0 9 * * 1', cronLabel: '每周一 09:00', icon: '🌐', desc: '基于企业中心行业与市场，联网检索需求、合规、渠道和竞争动态并附公开来源' },
  { templateId: 'crm_wakeup', taskType: 'crm_wakeup', name: '沉默客户唤醒', category: 'automation' as const, cronExpr: '0 10 * * 1', cronLabel: '每周一 10:00', icon: '💌', desc: '自动生成针对 60 天沉默老客的唤醒消息并推送' },
  { templateId: 'holiday_push', taskType: 'holiday_push', name: '节日推品提醒', category: 'monitor' as const, cronExpr: '0 9 * * *', cronLabel: '每天 09:00', icon: '🎉', desc: '节日前 7 天自动提醒备货和推品策略' },
];
export type TaskTemplate = (typeof TASK_TEMPLATES)[number];

export const TEMPLATE_GROUPS = [
  { id: 'video', label: '视频采集', desc: '按平台和关键词采集视频', taskTypes: ['video_keyword_crawl'] },
  { id: 'image', label: '图文采集', desc: '采集图片帖与图文内容', taskTypes: ['image_post_crawl'] },
  { id: 'competitor', label: '对标账号采集', desc: '采集已保存账号的最新内容', taskTypes: ['competitor_account_crawl'] },
  { id: 'automation', label: '其他自动化', desc: '报告、提醒和客户运营任务', taskTypes: ['trend_report', 'holiday_push', 'exchange_rate', 'market_intelligence', 'weekly_review', 'crm_wakeup'] },
] as const;

export const CRON_PRESETS = [
  { label: '每天 01:00（北京时间）', expr: '0 1 * * *' },
  { label: '每天 08:00', expr: '0 8 * * *' },
  { label: '每天 09:00', expr: '0 9 * * *' },
  { label: '每天 18:00', expr: '0 18 * * *' },
  { label: '每周一 10:00', expr: '0 10 * * 1' },
  { label: '每周五 18:00', expr: '0 18 * * 5' },
  { label: '每月1号 09:00', expr: '0 9 1 * *' },
];
export const CRAWLER_CRON_PRESET = CRON_PRESETS[0];
export const CRAWLER_LIMIT_MIN = 1;
export const CRAWLER_LIMIT_MAX = 50;
export const WEEKDAYS = [
  { value: '1', label: '周一' }, { value: '2', label: '周二' }, { value: '3', label: '周三' },
  { value: '4', label: '周四' }, { value: '5', label: '周五' }, { value: '6', label: '周六' }, { value: '0', label: '周日' },
];

export function templateSchedule(template: TaskTemplate): { time: string; days: string[] } {
  const [minute = '0', hour = '8', , , weekdays = '*'] = template.cronExpr.split(/\s+/);
  return {
    time: `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`,
    days: weekdays === '*' ? [] : weekdays.split(','),
  };
}

export function scheduleLabel(time: string, days: string[]): string {
  const dayLabel = days.length === 0
    ? '每天'
    : WEEKDAYS.filter(day => days.includes(day.value)).map(day => day.label).join('、');
  return `${dayLabel} ${time}（北京时间）`;
}

export function normalizedTemplateConfig(template: TaskTemplate): Record<string, string> {
  return Object.fromEntries(Object.entries(template.config ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

export function normalizeCrawlerLimit(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '5';
  return String(Math.max(CRAWLER_LIMIT_MIN, Math.min(CRAWLER_LIMIT_MAX, Math.round(numeric))));
}
