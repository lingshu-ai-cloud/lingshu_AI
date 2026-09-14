import { normalizeVideoPlan, type VideoCreationPlan } from './videoCreationPlan';
import { VIDEO_LANGUAGES, normalizeVideoLanguage } from './videoLanguages';
import type { WeeklyPackage } from './weeklyPackage';

export interface MatrixAccountPlan {
  accountId: string;
  platform: VideoCreationPlan['platform'];
  audience: string;
  productName: string;
  language: string;
  objective: string;
  contentDirection: string;
  cta: string;
  weeklyCount: number;
  sourceProjectIds: string[];
}
export interface MatrixAccountReview {
  accountId: string;
  platform: string;
  planned: number;
  produced: number;
  published: number;
  views: number | null;
  interactions: number | null;
  inquiries: number | null;
  recommendation: string;
}
const clean = (v: unknown, limit = 500) => String(v ?? '').trim().slice(0, limit);
export function normalizeMatrixPlan(value: unknown): MatrixAccountPlan[] {
  if (!Array.isArray(value) || value.length > 30) throw Error('矩阵安排最多支持 30 个账号');
  return value.map(raw => {
    if (!raw || typeof raw !== 'object') throw Error('矩阵账号安排格式无效');
    return { accountId: clean(raw.accountId, 160), platform: clean(raw.platform) as MatrixAccountPlan['platform'],
      audience: clean(raw.audience), productName: clean(raw.productName, 180), language: normalizeVideoLanguage(raw.language),
      objective: clean(raw.objective), contentDirection: clean(raw.contentDirection), cta: clean(raw.cta),
      weeklyCount: Number(raw.weeklyCount), sourceProjectIds: Array.isArray(raw.sourceProjectIds) ? [...new Set<string>(raw.sourceProjectIds.map((id: unknown) => clean(id, 160)).filter(Boolean))].slice(0, 30) : [] };
  });
}
export function bindMatrixVideo(plan: VideoCreationPlan, row?: MatrixAccountPlan): VideoCreationPlan {
  return normalizeVideoPlan({ ...plan, ...(row ? { platform: row.platform, productName: row.productName, language: row.language,
    ...(plan.productName !== row.productName ? { materialIds: [], scenePlan: plan.scenePlan?.map(scene => ({ ...scene, materialId: '' })) } : {}) } : {}),
    matrix: row ? { accountId: row.accountId, audience: row.audience, objective: row.objective, cta: row.cta } : { accountId: '', audience: '', objective: '', cta: '' } });
}
/** Preserve user-authored themes, sources and scenes; only add missing deliverables. */
export function fillMatrixVideos(pack: WeeklyPackage, defaults: Partial<VideoCreationPlan>, dueAt: string): WeeklyPackage {
  const rows = pack.matrixPlan || [];
  const existing = pack.tasks.find(t => t.templateId === 'production');
  const plans = (existing?.videoPlans || []).map(plan => bindMatrixVideo(plan, rows.find(row => row.accountId === plan.matrix?.accountId)));
  for (const row of rows) {
    const assigned = plans.filter(plan => plan.matrix?.accountId === row.accountId).length;
    const missing = row.weeklyCount - row.sourceProjectIds.length - assigned;
    for (let i = 0; i < missing && plans.length < 30; i++) {
      const slot = assigned + i;
      const theme = row.weeklyCount === 1 && row.contentDirection ? row.contentDirection : `待编导确认的买家问题 ${slot + 1}`;
      plans.push(bindMatrixVideo(normalizeVideoPlan({ ...defaults, contentId: crypto.randomUUID(), route: 'product', theme, buyerProblem: '', directorStatus: 'candidate', plannedPublishDate: '' }), row));
    }
  }
  const production = existing ? { ...existing, videoPlans: plans } : { templateId: 'production' as const, title: '制作产品视频', ownerId: '', ownerName: '', dueAt, notes: '', sourceProjectIds: [], videoPlans: plans };
  const projects = [...new Set(rows.flatMap(row => row.sourceProjectIds))];
  let tasks = pack.tasks.map(task => task.templateId === 'production' ? production : task.templateId === 'publishing' ? { ...task, sourceProjectIds: projects } : task);
  if (!existing && plans.length) tasks = [...tasks, production];
  return { ...pack, tasks };
}
export function matrixScopeIssues(pack: WeeklyPackage, targets: Array<{ accountId: string; platform: string }>, platforms: string[]): string[] {
  return pack.matrixPlan?.some(row => !targets.some(target => target.accountId === row.accountId && target.platform === row.platform) || !platforms.includes(row.platform)) ? ['矩阵账号必须属于本计划及本周平台范围'] : [];
}
export function matrixIssues(pack: WeeklyPackage): string[] {
  if (!pack.matrixPlan) return [];
  const rows = pack.matrixPlan;
  const plans = pack.tasks.find(t => t.templateId === 'production')?.videoPlans || [];
  const publishing = pack.tasks.some(t => t.templateId === 'publishing');
  const issues: string[] = [];
  if (new Set(rows.map(row => row.accountId)).size !== rows.length) issues.push('同一账号只能有一份本周矩阵安排');
  for (const row of rows) {
    if (!row.accountId || !['facebook', 'instagram', 'tiktok', 'youtube'].includes(row.platform)) issues.push('请选择有效的矩阵账号');
    if (![row.audience, row.productName, row.objective, row.contentDirection, row.cta].every(Boolean) || !(row.language in VIDEO_LANGUAGES)) issues.push('请补齐矩阵账号的受众、产品、语言、目标、内容方向和行动引导');
    if (!Number.isInteger(row.weeklyCount) || row.weeklyCount < 1 || row.weeklyCount > 30) issues.push('每个账号本周计划条数须为 1–30');
    const assigned = plans.filter(plan => plan.matrix?.accountId === row.accountId);
    if (assigned.length + row.sourceProjectIds.length !== row.weeklyCount) issues.push(`${row.platform} 账号的内容数量与本周计划不一致，请补齐视频计划或调整条数`);
    if (publishing && !pack.authorization.accountIds.includes(row.accountId)) issues.push('矩阵账号不在本周允许发布的账号范围内');
    if (assigned.some(plan => plan.platform !== row.platform || plan.productName !== row.productName || plan.language !== row.language || plan.matrix?.audience !== row.audience || plan.matrix?.objective !== row.objective || plan.matrix?.cta !== row.cta)) issues.push('账号策略已修改，请同步视频计划后再执行');
  }
  if (plans.some(plan => plan.matrix?.accountId && !rows.some(row => row.accountId === plan.matrix?.accountId))) issues.push('视频绑定的账号已从矩阵移除，请重新选择账号');
  const sources = pack.tasks.find(t => t.templateId === 'publishing')?.sourceProjectIds || [];
  if (publishing && (sources.some(id => !rows.some(row => row.sourceProjectIds.includes(id))) || rows.some(row => row.sourceProjectIds.some(id => !sources.includes(id))))) issues.push('已有作品的账号安排与发布任务不一致，请同步视频计划');
  if (publishing && !rows.length) issues.push('请安排至少一个矩阵账号，或移除本周发布任务');
  return [...new Set(issues)];
}
