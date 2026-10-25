import type { MetaAdGoal } from './metaAdObjectives';
export const META_AD_JOURNEYS: Record<MetaAdGoal, { user: string[]; automatic: string[]; customer: string; result: string; prerequisites: string[] }> = {
  '提升网站访问': {
    user: ['推广网站与页面内容', '广告视频、文案及语言'], automatic: ['关联主页、视频与封面', '配置网站点击目标和行动按钮', '核对网址格式与平台资源归属'], customer: '看到广告 → 点击了解更多 → 打开企业网站', result: '链接点击；不计作询盘或成交', prerequisites: ['有效的 HTTPS 落地页'],
  },
  '提升有效视频观看': {
    user: ['投放视频、字幕与语言', '广告文案'], automatic: ['关联视频与封面', '配置视频内观看和 ThruPlay 优化', '不索取网站、Pixel 或表单'], customer: '看到广告 → 在 Facebook / Instagram 观看视频', result: 'ThruPlay；不计作网站访问或客户线索', prerequisites: ['同账户下已处理就绪的视频'],
  },
  '获取消息会话': {
    user: ['客户进入的消息应用', '广告视频、文案及语言'], automatic: ['读取主页已关联的消息账户', '关联号码或 Instagram 专业账户', '配置发起消息会话目标'], customer: '点击广告 → 打开所选消息应用 → 主动发起对话', result: '发起会话；不等于有效询盘或成交', prerequisites: ['消息目的地已与主页关联'],
  },
  '获取Meta表单线索': {
    user: ['获客承诺、表单语言与问题', '隐私说明及提交完成页', '多个表单时确认业务版本'], automatic: ['读取并关联所选主页的有效表单', '关联表单编号和广告按钮', '核对表单状态、归属及条款状态'], customer: '点击广告 → 打开即时表单 → 填写并确认 → 提交 → 完成页', result: '已提交的 Meta 表单线索', prerequisites: ['已发布的有效表单', '真实隐私政策及主页线索广告条款'],
  },
  '获取独立站询盘': {
    user: ['推广的询盘页面', '广告视频、文案及语言', '多个数据源时确认对应网站'], automatic: ['读取并关联账户网站数据源', '配置网站 Lead 优化与行动按钮', '核对数据源归属，不把点击当作询盘'], customer: '点击广告 → 打开网站询盘页 → 填写需求 → 提交 → 网站回传 Lead', result: '网站 Lead 事件；仍须验证真实提交与事件回传', prerequisites: ['可用的询盘页及网站数据源', '成功提交时正确回传 Lead'],
  },
};
export const META_COMMON_CONFIRMATIONS = ['投放目标', '投放国家或地区', '账户与预算币种', '总预算上限和日预算', '投放渠道及时间安排'];
export const metaNeedsWebsite = (goal: string) => goal === '提升网站访问' || goal === '获取独立站询盘';
// Explicit business choice; never infer geography from free text or default to US.
export const AD_COUNTRY_CODES = ['US','CA','GB','DE','FR','ES','IT','NL','BE','CH','AT','PL','SE','NO','DK','FI','IE','PT','AU','NZ','SG','MY','ID','TH','VN','PH','JP','KR','IN','AE','SA','QA','KW','OM','BH','TR','IL','EG','ZA','NG','KE','MX','BR','AR','CL','CO','PE'] as const;
export const adCountryName = (code: string) => new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(code) || code;
export function normalizeAdCountries(input: unknown): string[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 50 || input.some(v => typeof v !== 'string' || !/^[A-Z]{2}$/.test(v))) throw new Error('请选择有效的投放国家或地区');
  return [...new Set(input as string[])];
}
export function metaBusinessMissing(goal: string, input: { pageId: string; videoId: string; imageUrl: string; message: string; countries: string; dailyBudget: number; linkUrl: string }, totalBudget: number): string[] {
  const missing: string[] = [];
  if (!input.pageId) missing.push('可用于广告的主页');
  if (!input.videoId || !input.imageUrl) missing.push('已确认的视频与封面');
  if (!input.countries.split(',').filter(Boolean).length) missing.push('投放国家或地区');
  if (!input.message.trim()) missing.push('广告文案');
  if (!(input.dailyBudget >= 1 && input.dailyBudget <= totalBudget)) missing.push('预算范围内的日预算');
  if (metaNeedsWebsite(goal)) { try { const url = new URL(input.linkUrl); if (url.protocol !== 'https:' || url.username || url.password) throw Error(); } catch { missing.push(goal === '获取独立站询盘' ? '询盘页面' : '推广网站'); } }
  return missing;
}
