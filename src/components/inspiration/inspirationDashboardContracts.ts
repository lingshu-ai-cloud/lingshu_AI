import type { BenchmarkAnalysis } from '../../../shared/benchmarkAnalysis';
import type { SocialBusinessModel, SocialDiscoveryScoreDecision } from '../../../shared/contracts/socialContentWorkflow';
import type { Page } from '../../App';
import type { Platform, TrendVideo } from '../../lib/inspirationTypes';
import type { Material } from '../../lib/studioApi';

export type SortMode = 'heat' | 'crawlTime';

export type ScriptType = 'voiceover' | 'storyboard';

export type InspirationInnerView = 'inspiration' | 'accounts' | 'library' | 'shooting';

export type CrawlTimeRange = 'all' | 'today' | '7d' | '30d';

export type DiscoveryDecisionFilter = 'all' | SocialDiscoveryScoreDecision;

export type BusinessModelFilter = 'all' | SocialBusinessModel;

export const INSPIRATION_PAGE_SIZE = 100;

export const MATERIAL_LIBRARY_PAGE_SIZE = 20;

export const MATERIAL_PRODUCT_ALL = '__all_products__';

export const MATERIAL_PRODUCT_COMMON = '__enterprise_common__';

export const MATERIAL_PRODUCT_LINKED_REF = '__linked_product_ref__';

export const PLATFORM_FILTERS: { id: Platform; label: string }[] = [
  { id: 'all',       label: '全部平台' },
  { id: 'youtube',   label: 'YouTube' },
  { id: 'tiktok',    label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook',  label: 'Facebook' },
  { id: 'linkedin',  label: 'LinkedIn' },
];

export interface GeneratedVideo {
  id: string;
  title: string;
  url?: string;
  poster?: string;
  duration: number;
  createdAt: string;
  source?: string;
  material?: Material;
  error?: string;
}

export interface InspirationDashboardProps {
  onScriptPanelOpen?: () => void;
  onScriptPanelClose?: () => void;
  onNavigate?: (p: Page) => void;
  onEnterWorkflow?: (payload: {
    source?: string;
    script?: string;
    video: TrendVideo;
    scriptType?: ScriptType;
    language?: string;
    productInfo?: string;
    materialRole?: 'hook';
    generatedVideo?: GeneratedVideo;
    referenceAnalysis?: {
      title?: string;
      visualStyle?: string;
      coreEmotion?: string;
      benchmarkAnalysis?: BenchmarkAnalysis;
      details?: { time: string; shot: string; camera: string; visual: string; subtitle?: string; audio?: string; note?: string }[];
    };
  }) => void;
}

export type StateSetter<T> = import('react').Dispatch<import('react').SetStateAction<T>>;
