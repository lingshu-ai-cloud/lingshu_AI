import { useEffect, useRef } from 'react';
import type { SocialAccountPresenterLock, SocialContentTaskDetail } from '../../../shared/contracts/socialContentWorkflow';
import { socialContentApi } from '../../lib/socialContentApi';

export type StudioContentTheme = 'product_proof' | 'use_case' | 'supplier_capability' | 'customization' | 'customer_case';

export interface StudioSocialTaskSeed {
  projectTitle: string;
  productReference: string;
  contentMode: 'video' | 'poster';
  creationMode: 'material' | 'product';
  platform: string;
  aspectRatio: string;
  languageCodes: string[];
  productInfo: string;
  audience: string;
  primaryCta: string;
  sellingPoints: string;
  contentTheme: StudioContentTheme | null;
  /** Free-form customer wording that should guide the generated story, not replace verified product facts. */
  themeTopic: string;
  factVerificationNotice: string;
  selectedMaterialIds: string[];
  unsupportedLanguages: string[];
  digitalHumanShotPlans: Array<{
    shotId: string;
    shotIndex: number;
    requestedDescription: string;
    workflow: 'material_processing' | 'viral_replication';
    method: 'talking' | 'replace' | 'reenact';
    presenterAssetIds: string[];
    referenceMaterialIds: string[];
    referenceRequired: boolean;
    candidateTools: string[];
    executionState: 'needs_presenter' | 'needs_confirmation' | 'preview_only' | 'ready_for_capability_check';
    accountPresenterLock: SocialAccountPresenterLock | null;
    sourceTaskId: string;
    sourceTaskVersion: string;
  }>;
}

const STUDIO_THEME_BY_SOCIAL_THEME = {
  product_value: 'product_proof',
  scenario_solution: 'use_case',
  supplier_capability: 'supplier_capability',
  customization_process: 'customization',
  customer_case: 'customer_case',
} as const satisfies Record<NonNullable<NonNullable<SocialContentTaskDetail['theme']>['themeId']>, StudioContentTheme>;

export function socialThemeToStudioTheme(task: Pick<SocialContentTaskDetail, 'theme'>): StudioContentTheme | null {
  const themeId = task.theme?.themeId;
  return themeId ? STUDIO_THEME_BY_SOCIAL_THEME[themeId] : null;
}

const LANGUAGE_CODES: Record<string, string> = {
  english: 'en', 英语: 'en', en: 'en', chinese: 'zh', 中文: 'zh', 简体中文: 'zh', zh: 'zh',
  spanish: 'es', 西班牙语: 'es', 西语: 'es', es: 'es', french: 'fr', 法语: 'fr', fr: 'fr',
  german: 'de', 德语: 'de', de: 'de', portuguese: 'pt', 葡萄牙语: 'pt', 葡语: 'pt', pt: 'pt',
  italian: 'it', 意大利语: 'it', it: 'it', russian: 'ru', 俄语: 'ru', ru: 'ru',
  japanese: 'ja', 日语: 'ja', ja: 'ja', korean: 'ko', 韩语: 'ko', ko: 'ko',
  arabic: 'ar', 阿拉伯语: 'ar', 阿语: 'ar', ar: 'ar', hindi: 'hi', 印地语: 'hi', hi: 'hi',
  indonesian: 'id', 印度尼西亚语: 'id', 印尼语: 'id', id: 'id', thai: 'th', 泰语: 'th', th: 'th',
  vietnamese: 'vi', 越南语: 'vi', vi: 'vi', turkish: 'tr', 土耳其语: 'tr', tr: 'tr',
  dutch: 'nl', 荷兰语: 'nl', nl: 'nl', polish: 'pl', 波兰语: 'pl', pl: 'pl',
};

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function materialId(sourceRef: string): string | null {
  const token = /^socialmaterial:([a-zA-Z0-9_-]+)$/.exec(sourceRef)?.[1];
  if (!token || typeof globalThis.atob !== 'function') return null;
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(token.length / 4) * 4, '=');
    const bytes = Uint8Array.from(globalThis.atob(padded), character => character.charCodeAt(0));
    const id = new TextDecoder().decode(bytes).trim();
    return /^[a-zA-Z0-9._:-]{1,200}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function languageCode(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return LANGUAGE_CODES[value.trim()] || LANGUAGE_CODES[normalized] || null;
}

export function socialTaskToStudioSeed(task: SocialContentTaskDetail): StudioSocialTaskSeed {
  const brief = task.brief;
  const contentMode = brief.formats.some(format => format === 'short_video' || format === 'long_video') ? 'video' : 'poster';
  const languagePairs = brief.languages.map(language => ({ language, code: languageCode(language) }));
  const languageCodes = [...new Set(languagePairs.map(item => item.code).filter((code): code is string => Boolean(code)))];
  const selectedMaterialIds = [...new Set(task.sources
    .filter(source => source.status === 'active' && source.kind === 'material')
    .map(source => materialId(source.sourceRef))
    .filter((id): id is string => Boolean(id)))];
  const pendingFacts = [
    brief.productRef ? `产品引用“${brief.productRef}”` : '',
    brief.brandNotes ? '任务备注' : '',
  ].filter(Boolean);
  const digitalHumanShotPlans = (task.assetSupplyPlan?.shots ?? []).flatMap((shot, shotIndex) => shot.digitalHumanPlan ? [{
    shotId: shot.shotId,
    shotIndex,
    requestedDescription: clean(shot.requestedDescription),
    ...shot.digitalHumanPlan,
    presenterAssetIds: [...shot.digitalHumanPlan.presenterAssetIds],
    referenceMaterialIds: [...shot.digitalHumanPlan.referenceMaterialIds],
    candidateTools: [...shot.digitalHumanPlan.candidateTools],
    accountPresenterLock: shot.digitalHumanPlan.accountPresenterLock ?? null,
    sourceTaskId: task.taskId,
    sourceTaskVersion: task.version,
  }] : []);
  return {
    projectTitle: clean(brief.title) || '社媒内容任务',
    productReference: clean(brief.productRef),
    contentMode,
    creationMode: selectedMaterialIds.length ? 'material' : 'product',
    platform: clean(brief.platforms[0]).toLowerCase() || (contentMode === 'poster' ? 'facebook' : 'tiktok'),
    aspectRatio: clean(brief.aspectRatio) || (contentMode === 'poster' ? '1:1' : '9:16'),
    languageCodes: languageCodes.length ? languageCodes : ['zh'],
    // Brief productRef/brandNotes are request free text, not confirmed facts.
    // Studio will hydrate its product input only from the tenant enterprise profile.
    productInfo: '',
    audience: [clean(brief.audience), brief.markets.length ? `目标市场：${brief.markets.join('、')}` : ''].filter(Boolean).join('；'),
    primaryCta: clean(brief.callToAction),
    sellingPoints: '',
    contentTheme: socialThemeToStudioTheme(task),
    themeTopic: task.theme?.inputKind === 'custom' ? clean(task.theme.topic) : '',
    factVerificationNotice: pendingFacts.length
      ? `${pendingFacts.join('和')}未作为已确认企业事实导入；请在企业中心选择并核对产品资料后再生成。`
      : '',
    selectedMaterialIds,
    unsupportedLanguages: languagePairs.filter(item => !item.code).map(item => item.language),
    digitalHumanShotPlans,
  };
}

export function useStudioSocialTaskHydration(input: {
  taskId?: string | null;
  canApply: () => boolean;
  onHydrate: (seed: StudioSocialTaskSeed) => void;
}): void {
  const canApplyRef = useRef(input.canApply);
  const onHydrateRef = useRef(input.onHydrate);
  canApplyRef.current = input.canApply;
  onHydrateRef.current = input.onHydrate;

  useEffect(() => {
    const taskId = input.taskId?.trim();
    if (!taskId) return;
    const controller = new AbortController();
    void socialContentApi.getTask(taskId, controller.signal).then(task => {
      if (!controller.signal.aborted && canApplyRef.current()) onHydrateRef.current(socialTaskToStudioSeed(task));
    }).catch(() => undefined);
    return () => controller.abort();
  }, [input.taskId]);
}
