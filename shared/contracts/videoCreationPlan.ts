import { VIDEO_LANGUAGES, normalizeVideoLanguage } from './videoLanguages.js';
import type { SocialAccountRole } from './socialOperatingProfile.js';

/** Frozen user choices shared by planning, script, voice and rendering. */
export interface VideoCreationPlan {
  contentId?: string;
  plannedPublishDate?: string;
  buyerProblem?: string;
  evidenceRequirement?: string;
  directorStatus?: 'candidate' | 'script_draft' | 'script_approved' | 'in_production' | 'review' | 'approved' | 'blocked';
  estimatedCost?: number;
  /** Auditable evidence used by the Business Agent when it proposed this slot. */
  planningEvidence?: {
    generatedFrom: 'matrix_benchmark_viral' | 'matrix_viral' | 'matrix_product';
    matrixAccountId: string;
    requiredCount: number;
    slot: number;
    referenceTitle: string;
    referenceViews: string;
    benchmarkAccount: string;
    matchScore: number;
    factors: string[];
  };
  matrix?: { accountId: string; audience: string; objective: string; cta: string; accountRole?: SocialAccountRole; formats?: string[] };
  reviewRequirements?: Array<{ todoId: string; reference: string; scene: number; startsAt: number; endsAt: number; requirements: string; materials: string; acceptance: string }>;
  route: 'clone' | 'material' | 'product';
  productName: string;
  theme: string;
  language: string;
  duration: number;
  platform: 'facebook' | 'instagram' | 'tiktok' | 'youtube';
  materialIds: string[];
  referenceId: string;
  presenter: 'material' | 'heygen' | 'avatar';
  scenePlan?: VideoSceneChoice[];
  heygenAvatarId: string;
  avatarConsent: boolean;
  voice: string;
}
export interface VideoSceneChoice { source: 'avatar' | 'material'; materialId: string }
export const VIDEO_PRESENTATIONS = { material: '纯素材剪辑', avatar: '纯数字人口播', heygen: '数字人 + 素材混剪' } as const;
export const usesDigitalPresenter = (plan: Pick<VideoCreationPlan, 'presenter'>) => plan.presenter === 'avatar' || plan.presenter === 'heygen';
export const defaultMixedScenes = (count = 4): VideoSceneChoice[] => Array.from({ length: count }, (_, index) => ({ source: index === 0 || index === count - 1 ? 'avatar' : 'material', materialId: '' }));
export function presentationScenes(plan: VideoCreationPlan, count: number): VideoSceneChoice[] {
  if (!Number.isInteger(count) || count < 1) throw Error('缺少有效分镜');
  if (plan.presenter === 'avatar') return Array.from({ length: count }, () => ({ source: 'avatar', materialId: '' }));
  if (plan.presenter === 'material') {
    if (plan.scenePlan?.length) {
      if (plan.scenePlan.length !== count || plan.scenePlan.some(s => s.source !== 'material' || s.materialId && !plan.materialIds.includes(s.materialId))) throw Error('纯素材分镜绑定无效');
      return plan.scenePlan;
    }
    return Array.from({ length: count }, () => ({ source: 'material', materialId: '' }));
  }
  const scenes = plan.scenePlan?.length ? plan.scenePlan : defaultMixedScenes(count);
  if (scenes.length !== count) throw Error('分镜数量与已确认画面安排不同，请重新生成或调整分镜');
  if (!scenes.some(scene => scene.source === 'avatar') || !scenes.some(scene => scene.source === 'material')) throw Error('混剪必须同时包含数字人和素材镜头，请调整分镜或更改成片方式');
  for (const scene of scenes) {
    if (!['avatar', 'material'].includes(scene.source)) throw Error('未知分镜画面来源');
    if (scene.source === 'material' && scene.materialId && !plan.materialIds.includes(scene.materialId)) throw Error('分镜引用了未选择的素材，请重新绑定');
  }
  return scenes;
}
export const VIDEO_ROUTES = { clone: '爆款裂变', material: '从素材生成', product: '从产品生成' } as const;
export function normalizeVideoPlan(value: Partial<VideoCreationPlan>): VideoCreationPlan {
  return {
    contentId: String(value.contentId || '').trim().slice(0, 120),
    plannedPublishDate: /^\d{4}-\d{2}-\d{2}$/.test(String(value.plannedPublishDate || '')) ? String(value.plannedPublishDate) : '',
    buyerProblem: String(value.buyerProblem || '').trim().slice(0, 500),
    evidenceRequirement: String(value.evidenceRequirement || '').trim().slice(0, 1000),
    directorStatus: ['candidate', 'script_draft', 'script_approved', 'in_production', 'review', 'approved', 'blocked'].includes(String(value.directorStatus)) ? value.directorStatus : 'candidate',
    estimatedCost: Math.max(0, Math.round((Number(value.estimatedCost) || 0) * 100) / 100),
    ...(value.planningEvidence && typeof value.planningEvidence === 'object' ? { planningEvidence: {
      generatedFrom: ['matrix_benchmark_viral', 'matrix_viral', 'matrix_product'].includes(String(value.planningEvidence.generatedFrom))
        ? value.planningEvidence.generatedFrom
        : 'matrix_product',
      matrixAccountId: String(value.planningEvidence.matrixAccountId || '').trim().slice(0, 160),
      requiredCount: Math.max(1, Math.min(30, Math.floor(Number(value.planningEvidence.requiredCount) || 1))),
      slot: Math.max(1, Math.min(30, Math.floor(Number(value.planningEvidence.slot) || 1))),
      referenceTitle: String(value.planningEvidence.referenceTitle || '').trim().slice(0, 500),
      referenceViews: String(value.planningEvidence.referenceViews || '').trim().slice(0, 80),
      benchmarkAccount: String(value.planningEvidence.benchmarkAccount || '').trim().slice(0, 300),
      matchScore: Math.max(0, Math.min(100, Math.round(Number(value.planningEvidence.matchScore) || 0))),
      factors: Array.isArray(value.planningEvidence.factors)
        ? [...new Set(value.planningEvidence.factors.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 8).map(item => item.slice(0, 160))
        : [],
    } } : {}),
    ...(value.matrix && typeof value.matrix === 'object' ? { matrix: {
      accountId: String(value.matrix.accountId || '').trim().slice(0, 160), audience: String(value.matrix.audience || '').trim().slice(0, 500), objective: String(value.matrix.objective || '').trim().slice(0, 500), cta: String(value.matrix.cta || '').trim().slice(0, 500),
      accountRole: ['brand_capability', 'buyer_advisor', 'brand_combined'].includes(String(value.matrix.accountRole)) ? value.matrix.accountRole : 'brand_combined',
      formats: Array.isArray(value.matrix.formats) ? [...new Set(value.matrix.formats.map(item => String(item).trim()).filter(Boolean))].slice(0, 8) : [],
    } } : {}),
    ...(Array.isArray(value.reviewRequirements) ? { reviewRequirements: value.reviewRequirements.slice(0, 5).map(r => ({ todoId: String(r.todoId || '').slice(0, 80), reference: String(r.reference || '').slice(0, 4000), scene: 1, startsAt: 0, endsAt: 3, requirements: String(r.requirements || '').slice(0, 4000), materials: String(r.materials || '').slice(0, 4000), acceptance: String(r.acceptance || '').slice(0, 4000) })) } : {}),
    route: ['clone', 'material', 'product'].includes(String(value.route)) ? value.route! : 'product',
    productName: String(value.productName || '').trim().slice(0, 180), theme: String(value.theme || '').trim().slice(0, 500),
    language: normalizeVideoLanguage(value.language || 'en'), duration: Math.max(10, Math.min(180, Number(value.duration) || 30)),
    platform: ['facebook', 'instagram', 'tiktok', 'youtube'].includes(String(value.platform)) ? value.platform! : 'youtube',
    materialIds: Array.isArray(value.materialIds) ? [...new Set(value.materialIds.map(String))].slice(0, 30) : [],
    referenceId: String(value.referenceId || '').trim().slice(0, 160),
    presenter: value.presenter === 'heygen' || value.presenter === 'avatar' ? value.presenter : 'material',
    ...(Array.isArray(value.scenePlan) ? { scenePlan: value.scenePlan.slice(0, 8).map(scene => ({ source: String(scene.source) as VideoSceneChoice['source'], materialId: scene.source === 'material' ? String(scene.materialId || '').slice(0, 160) : '' })) } : {}), heygenAvatarId: String(value.heygenAvatarId || '').trim().slice(0, 160),
    avatarConsent: value.avatarConsent === true, voice: String(value.voice || 'v1').slice(0, 160),
  };
}
export function videoPlanErrors(plan: VideoCreationPlan): string[] {
  const sceneErrors: string[] = [];
  if (plan.presenter === 'heygen' && plan.scenePlan?.length) {
    if (plan.scenePlan.length < 3) sceneErrors.push('混剪需要至少三镜');
    try { presentationScenes(plan, plan.scenePlan.length); } catch (error) { sceneErrors.push((error as Error).message); }
  }
  return [...sceneErrors,!(plan.language in VIDEO_LANGUAGES) && '请选择支持的语言', !plan.productName && '请选择产品', !plan.theme && '请填写本条主题或买家问题',
    plan.route === 'clone' && !plan.referenceId && '请选择爆款参考',
    plan.route === 'material' && !plan.materialIds.length && '请选择本条素材',
    plan.presenter === 'heygen' && !plan.materialIds.length && '数字人混剪需选择产品画面素材',
    usesDigitalPresenter(plan) && (!plan.heygenAvatarId || !plan.avatarConsent) && '请选择 HeyGen 人物并确认使用权',
  ].filter(Boolean) as string[];
}
export function spokenLanguageMatches(text: string, language: string): boolean {
  const code = normalizeVideoLanguage(language);
  const letters = (text.match(/[\p{L}]/gu) || []).length;
  if (!letters || !(code in VIDEO_LANGUAGES)) return false;
  const ratio = (pattern: RegExp) => (text.match(pattern) || []).length / letters;
  if (code === 'zh') return ratio(/[\u3400-\u9fff]/g) > 0.2 && ratio(/[\u3040-\u30ff]/g) < 0.05;
  if (code === 'ja') return ratio(/[\u3040-\u30ff]/g) > 0.1;
  if (code === 'ko') return ratio(/[\uac00-\ud7af]/g) > 0.2;
  if (code === 'ar') return ratio(/[\u0600-\u06ff]/g) > 0.2;
  if (code === 'ru') return ratio(/[\u0400-\u04ff]/g) > 0.2;
  return ratio(/[\p{Script=Latin}]/gu) > 0.8;
}
