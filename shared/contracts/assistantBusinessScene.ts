import { normalizeVideoLanguage, VIDEO_LANGUAGES } from './videoLanguages';
import { z } from 'zod';
export const BUSINESS_SCENES = {
  'OP-01': '周经营任务', 'OP-05': '今天优先做什么', 'OP-07': '复盘本周经营', 'OP-08': '规划下一轮动作',
  'OP-04': '数据分析', 'OP-06': '检查经营健康度', 'PU-04': '检查账号表现',
  'AD-01': '分析投放数据', 'AD-02': '制定投放计划', 'AD-03': '推荐渠道与受众', 'AD-04': '规划预算与目标', 'AD-06': '检查投放执行与风险',
  'CS-01': '优先跟进谁', 'CS-02': '总结当前会话', 'CS-03': '生成回复草稿', 'CS-05': '筛选高质量询盘', 'CS-07': '制定客户跟进计划', 'CS-09': '补全客户画像',
  'CO-07': '改写成多平台版本',
} as const;
export type BusinessSceneId = keyof typeof BUSINESS_SCENES;
export const businessScenePromptSchema = z.object({ sceneId: z.enum(Object.keys(BUSINESS_SCENES) as [BusinessSceneId, ...BusinessSceneId[]]), preferredId: z.string().max(150).optional() }).strict();
export type BusinessScenePrompt = z.infer<typeof businessScenePromptSchema>;
export const isBusinessScene = (id: string): id is BusinessSceneId => Object.hasOwn(BUSINESS_SCENES, id);
const id = z.string().trim().min(1).max(150);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().startsWith(v));
export const sceneSelectionSchema = z.object({
  sceneId: z.enum(Object.keys(BUSINESS_SCENES) as [BusinessSceneId, ...BusinessSceneId[]]),
  from: day, to: day, customerId: id.optional(), adTaskId: id.optional(),
}).strict().superRefine((v, ctx) => {
  const span = Date.parse(v.to) - Date.parse(v.from);
  if (span < 0 || span > 92 * 86400000) ctx.addIssue({ code: 'custom', message: '请选择不超过93天的有效日期范围。' });
  if (['CS-02', 'CS-03', 'CS-07', 'CS-09'].includes(v.sceneId) && !v.customerId) ctx.addIssue({ code: 'custom', message: '请选择客户。' });
  if (['AD-01', 'AD-06'].includes(v.sceneId) && !v.adTaskId) ctx.addIssue({ code: 'custom', message: '请选择投放计划。' });
});
export type BusinessSceneSelection = z.infer<typeof sceneSelectionSchema>;
export type BusinessSceneOptions = { customers: Array<{ id: string; label: string }>; ads: Array<{ id: string; label: string }>; scripts: Array<{ id: string; label: string }>; limitations: string[] };
export const REWRITE_PLATFORMS = ['TikTok', 'Instagram', 'YouTube', 'Facebook'] as const;
export const rewriteVariantSchema = z.object({ platform: z.enum(REWRITE_PLATFORMS), title: z.string().trim().min(1).max(200), script: z.string().trim().min(1).max(12000), caption: z.string().max(4000), rationale: z.string().max(1000) }).strict();
export const rewriteInputSchema = z.object({ sourceScriptId: id, platforms: z.array(z.enum(REWRITE_PLATFORMS)).min(1).max(4).refine(v => new Set(v).size === v.length), language: z.string().trim().min(1).max(50).transform(normalizeVideoLanguage).refine(v => Object.hasOwn(VIDEO_LANGUAGES, v), '请选择系统支持的输出语言。') }).strict();
export const rewriteSaveSchema = rewriteInputSchema.extend({ sourceHash: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.string().uuid(), variants: z.array(rewriteVariantSchema).min(1).max(4) }).strict().refine(v => v.variants.length === v.platforms.length && new Set(v.variants.map(x => x.platform)).size === v.platforms.length && v.variants.every(x => v.platforms.includes(x.platform)), '平台版本不一致。');

export function businessSceneFollowup(question: string, lastMessage: { role?: string; businessScene?: unknown } | undefined): BusinessSceneSelection | undefined {
  if (/新闻|资讯|汇率|贸易数据|行业趋势|政策|联网|公开来源|另一个客户|换个客户|切换计划|新话题/u.test(question) || !/^(?:继续|再|那|这个|该|它|为什么|如何|怎么|请(?:把|将|针对)|预算|时间|给这个|针对这个)/u.test(question.trim())) return undefined;
  const parsed = lastMessage?.role === 'assistant' ? sceneSelectionSchema.safeParse(lastMessage.businessScene) : null;
  return parsed?.success ? parsed.data : undefined;
}

export function defaultBusinessPeriod(sceneId: BusinessSceneId, now = new Date()) {
  const shifted = new Date(now.getTime() + 8 * 3600000);
  const to = shifted.toISOString().slice(0, 10);
  const days = 6;
  return { from: new Date(shifted.getTime() - days * 86400000).toISOString().slice(0, 10), to };
}
