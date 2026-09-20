import type {
  SocialContentTaskDetail,
  SocialContentTaskSummary,
  SocialContentThemeId,
  SocialWorkPackageCard,
  SocialWorkPackageKind,
} from '../../../shared/contracts/socialContentWorkflow';
import {
  EMPTY_SOCIAL_CONTENT_DRAFT,
  type SocialContentDraft,
} from '../../lib/socialContentModel';

export const SOCIAL_THEME_OPTIONS: ReadonlyArray<{
  id: SocialContentThemeId;
  title: string;
  description: string;
  shots: string[];
}> = [
  { id: 'product_value', title: '产品与卖点', description: '讲清产品、关键能力和可验证差异', shots: ['产品全貌', '关键细节', '使用演示', '证据'] },
  { id: 'scenario_solution', title: '场景与解决方案', description: '从真实问题出发展示解决过程', shots: ['场景', '问题', '解决动作', '结果与边界'] },
  { id: 'supplier_capability', title: '企业与供应保障', description: '展示团队、流程、质检和交付能力', shots: ['场所或团队', '流程', '质检', '仓储或交付'] },
  { id: 'customization_process', title: '定制与合作流程', description: '说明需求、打样、确认到交付', shots: ['需求', '方案', '样品', '确认', '生产交付'] },
  { id: 'customer_case', title: '客户案例与合作成果', description: '用已授权、可核验的证据讲成果', shots: ['授权背景', '问题', '方案', '结果', '授权证明'] },
];

export const PACKAGE_META: Record<SocialWorkPackageKind, { title: string; caption: string }> = {
  industry_launch: { title: '行业起航包', caption: '市场、受众与内容方向' },
  content_rocket: { title: '内容火箭包', caption: '选题、脚本与成品制作' },
  task_express: { title: '任务飞车包', caption: '制作推进、交付与复盘' },
};

export const PLATFORM_OPTIONS = [
  ['douyin_cn', '抖音'],
  ['tiktok', 'TikTok'],
  ['instagram', 'Instagram'],
  ['youtube', 'YouTube'],
  ['facebook', 'Facebook'],
  ['linkedin', 'LinkedIn'],
] as const;

export const FORMAT_OPTIONS = [
  ['short_video', '短视频'],
  ['image_post', '图文'],
  ['carousel', '轮播'],
  ['long_video', '长视频'],
] as const;

export const GOAL_OPTIONS = ['新品介绍', '品牌认知', '产品种草', '活动推广', '获取咨询', '客户教育'] as const;

const ARTIFACT_KIND_LABEL: Record<string, string> = {
  short_video: '短视频',
  long_video: '长视频',
  image_post: '图文内容',
  carousel: '轮播内容',
  script: '内容脚本',
  copy: '发布文案',
  caption: '发布文案',
  cover: '封面图',
};

export function artifactKindLabel(kind: string): string {
  const normalized = kind.trim().toLowerCase();
  if (ARTIFACT_KIND_LABEL[normalized]) return ARTIFACT_KIND_LABEL[normalized];
  if (normalized.includes('video')) return '视频内容';
  if (normalized.includes('image') || normalized.includes('visual')) return '视觉内容';
  if (normalized.includes('script')) return '内容脚本';
  return '内容成品';
}

export function optionLabel(options: readonly (readonly [string, string])[], value: string): string {
  return options.find(option => option[0] === value)?.[1] || value;
}

export function packageVersionLabel(version: string): string {
  const framework = /^framework-v(\d+)$/i.exec(version.trim());
  if (framework) return `第 ${framework[1]} 版`;
  const simple = /^v?(\d+(?:\.\d+)*)$/i.exec(version.trim());
  return simple ? `第 ${simple[1]} 版` : '当前版本';
}

const LANGUAGE_LABELS: Record<string, string> = {
  zh: '中文',
  'zh-cn': '简体中文',
  'zh-hans': '简体中文',
  'zh-tw': '繁体中文',
  'zh-hant': '繁体中文',
  en: '英语',
  'en-us': '英语',
  'en-gb': '英语',
  es: '西班牙语',
  fr: '法语',
  de: '德语',
  ja: '日语',
  ko: '韩语',
  pt: '葡萄牙语',
  ar: '阿拉伯语',
};

export function contentLanguageLabel(language: string | null): string | null {
  if (!language?.trim()) return null;
  const value = language.trim();
  return LANGUAGE_LABELS[value.toLowerCase()] || value;
}

export function availablePackagesByKind(catalog: SocialWorkPackageCard[], kind: SocialWorkPackageKind): SocialWorkPackageCard[] {
  return catalog.filter(item => item.kind === kind && item.available);
}

export function packageSelectionForCatalog(catalog: SocialWorkPackageCard[]): SocialContentDraft['packageSelection'] {
  return {
    industry_launch: availablePackagesByKind(catalog, 'industry_launch')[0]?.packageKey || 'framework-v1',
    content_rocket: availablePackagesByKind(catalog, 'content_rocket')[0]?.packageKey || 'framework-v1',
    task_express: availablePackagesByKind(catalog, 'task_express')[0]?.packageKey || 'framework-v1',
  };
}

export function taskToDraft(task: SocialContentTaskDetail | SocialContentTaskSummary | null, catalog: SocialWorkPackageCard[]): SocialContentDraft {
  const packageSelection = packageSelectionForCatalog(catalog);
  task?.packageSelection.forEach(item => { packageSelection[item.kind] = item.packageKey; });
  if (!task) return {
    ...EMPTY_SOCIAL_CONTENT_DRAFT,
    market: '全球',
    platforms: ['douyin_cn'],
    formats: ['short_video'],
    packageSelection,
  };
  return {
    ...EMPTY_SOCIAL_CONTENT_DRAFT,
    mode: task.mode ?? 'weekly',
    themeId: task.theme?.themeId ?? '',
    customTopic: task.theme?.inputKind === 'custom' ? task.theme.topic : '',
    topic: task.theme?.inputKind === 'preset' ? task.theme.topic : '',
    title: task.brief.title,
    productName: task.brief.productRef || '',
    primaryGoal: task.brief.objective,
    audience: task.brief.audience || '',
    market: task.brief.markets.join('、'),
    language: task.brief.languages.join('、') || EMPTY_SOCIAL_CONTENT_DRAFT.language,
    desiredDeliveryAt: task.brief.dueAt ? task.brief.dueAt.slice(0, 10) : '',
    referenceLinks: [],
    keyFacts: task.brief.brandNotes || '',
    prohibitedClaims: task.brief.restrictions.join('\n'),
    callToAction: task.brief.callToAction || '',
    platforms: task.brief.platforms,
    formats: task.brief.formats,
    aspectRatio: task.brief.aspectRatio || EMPTY_SOCIAL_CONTENT_DRAFT.aspectRatio,
    cadence: task.brief.cadence || '',
    quantity: task.brief.requestedOutputCount || 1,
    weeklyBudgetCny: task.brief.weeklyBudgetCny ?? null,
    perItemBudgetCny: task.brief.perItemBudgetCny ?? null,
    retryReserveCny: task.brief.retryReserveCny ?? null,
    planningMode: task.brief.planningMode ?? 'auto_adjust',
    shootingWindowMinutes: task.brief.shootingWindowMinutes ?? null,
    specialRequirements: task.brief.specialRequirements || '',
    packageSelection,
  };
}

export function splitBusinessList(value: string): string[] {
  return [...new Set(value.split(/[、,，;；\n]/).map(item => item.trim()).filter(Boolean))];
}

export function splitLines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map(item => item.trim()).filter(Boolean))];
}

export function dueDateLabel(value: string | null): string {
  if (!value) return '未设置交付日期';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未设置交付日期';
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}
