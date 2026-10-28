export const CONNECTION_PLATFORMS = ['tiktok', 'youtube', 'instagram', 'facebook', 'linkedin'] as const;
export type ConnectionPlatform = typeof CONNECTION_PLATFORMS[number];
export const CONNECTION_LABELS: Record<ConnectionPlatform, string> = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn' };
type Turn = { role: string; content: string };
export type AccountConnectionIntent = { platform?: ConnectionPlatform };
const platformIn = (text: string) => CONNECTION_PLATFORMS.filter(platform => new RegExp(`\\b${platform}\\b`, 'iu').test(text));
/** This recognizes a request to open a connection control, never permission to grant access. */
export function assistantAccountConnectionIntent(text: string, previous?: Turn): AccountConnectionIntent | null {
  const query = text.trim();
  if (/不(?:要|用|想)|先别|取消|稍后|删除|解绑|解除|断开|撤销|报告|解读|分析|为什么|为何|怎么|如何|能否|是否|查看|查询|检查|授权状态|授权情况|已(?:经)?(?:授权|连接|绑定)/u.test(query)) return null;
  const platforms = platformIn(query);
  const pending = previous?.role === 'assistant' && previous.content === accountConnectionReply();
  const request = /(?:补录|补充|连接|绑定|接入|添加|录入|授权)/u.test(query)
    && /账号|账户|渠道|oauth|tiktok|youtube|instagram|facebook|linkedin/iu.test(query);
  if (!request && !(pending && platforms.length === 1 && query.length < 40)) return null;
  return platforms.length === 1 ? { platform: platforms[0] } : {};
}
export function accountConnectionReply(platform?: ConnectionPlatform): string {
  return platform ? `在下方连接 ${CONNECTION_LABELS[platform]}。点击授权后，在平台官方页面选择账号；完成后系统会自动补录。`
    : '请选择要连接的平台。授权会在平台官方页面完成，完成后系统自动补录账号。';
}
export function accountConnectionReplyPlatform(text: string): AccountConnectionIntent | null {
  if (text === accountConnectionReply()) return {};
  const platform = CONNECTION_PLATFORMS.find(platform => text === accountConnectionReply(platform));
  return platform ? { platform } : null;
}
