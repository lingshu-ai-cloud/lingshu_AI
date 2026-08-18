import type { Page } from '../App';

export type SocialPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';

export type ContentActionEvidence = {
  contentId?: string;
  title?: string;
  platform?: SocialPlatform;
  thumbnail?: string;
  videoUrl?: string;
  sourceUrl?: string;
  duration?: number;
  recordId?: string;
};

export type CreativeActionPrefill = {
  title: string;
  recommendation?: string;
  platform?: SocialPlatform;
  language?: string;
  evidence?: ContentActionEvidence;
  referenceAnalysis?: {
    title?: string;
    visualStyle?: string;
    coreEmotion?: string;
    details?: Array<Record<string, unknown>>;
  };
};

export type ScheduleActionPrefill = {
  templateId?: string;
  platform?: SocialPlatform;
  keywords?: string;
  name?: string;
  time?: string;
  days?: string[];
  runAfterCreate?: boolean;
};

export type ScriptLibraryActionPrefill = {
  tab?: 'inspiration' | 'studio';
  contentId?: string;
  projectId?: string;
  query?: string;
  openDetail?: boolean;
};

export const CONTENT_ACTION_STORAGE = {
  schedule: 'lingshu:scheduled:prefill',
  scriptLibrary: 'lingshu:script-library:prefill',
  studioKickoff: 'ow_video_kickoff',
} as const;

function navigate(page: Page, detail: Record<string, unknown> = {}) {
  window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page, ...detail } }));
}

export function openCreativeDraft(prefill: CreativeActionPrefill) {
  const evidence = prefill.evidence;
  const payload = {
    source: evidence?.contentId ? 'inspiration_analysis' : 'content_memory_recommendation',
    video: {
      id: evidence?.contentId || `memory-recommendation-${Date.now()}`,
      recordId: evidence?.recordId,
      platform: evidence?.platform || prefill.platform || 'tiktok',
      title: evidence?.title || prefill.title,
      thumbnail: evidence?.thumbnail,
      duration: evidence?.duration || 0,
      sourceUrl: evidence?.sourceUrl,
      videoUrl: evidence?.videoUrl,
      status: evidence?.contentId ? 'analyzed' : 'draft',
      contentFormat: 'video',
    },
    scriptType: 'storyboard',
    language: prefill.language || 'zh',
    productInfo: prefill.recommendation || '',
    referenceAnalysis: prefill.referenceAnalysis || {
      title: prefill.title,
      details: [],
    },
    actionContext: {
      source: 'agent_memory',
      recommendation: prefill.recommendation || '',
    },
  };
  window.localStorage.setItem(CONTENT_ACTION_STORAGE.studioKickoff, JSON.stringify(payload));
  navigate('smartAssets', { view: 'create' });
}

export function openScheduleCreator(prefill: ScheduleActionPrefill) {
  window.sessionStorage.setItem(CONTENT_ACTION_STORAGE.schedule, JSON.stringify({ ...prefill, at: Date.now() }));
  navigate('scheduled');
}

export function openScriptLibrary(prefill: ScriptLibraryActionPrefill = {}) {
  window.sessionStorage.setItem(CONTENT_ACTION_STORAGE.scriptLibrary, JSON.stringify({ ...prefill, at: Date.now() }));
  navigate('scriptLibrary');
}

export function consumeSessionPrefill<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    window.sessionStorage.removeItem(key);
    return JSON.parse(raw) as T;
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
}
