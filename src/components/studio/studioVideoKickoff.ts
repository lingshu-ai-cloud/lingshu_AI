import type { StudioScriptResult, Material } from '../../lib/studioApi';
import type { BenchmarkAnalysis } from '../../../shared/benchmarkAnalysis';

export interface VideoKickoff {
  source?: 'inspiration_analysis' | 'inspiration_image_post' | 'seedance_video' | string;
  script?: string;
  initialGeneration?: StudioScriptResult;
  scriptType?: 'voiceover' | 'storyboard';
  language?: string;
  productInfo?: string;
  actionContext?: { source?: string; recommendation?: string; workflowRunId?: string; workflowTaskId?: string };
  referenceAnalysis?: {
    narrationProducts?: string[]; narrationBrands?: string[];
    /** Canonical Director handoff. New Inspiration entries must carry this
     * snapshot so Studio evaluates the exact same evidence and shot rules. */
    benchmarkAnalysis?: BenchmarkAnalysis;
    title?: string;
    narrationSourceStatus?: 'asr_aligned' | 'missing_source_asr';
    visualStyle?: string;
    coreEmotion?: string;
    details?: { time: string; shotId?: string; personContinuityId?: string; observedPresenterRole?: import('../../../shared/contracts/presenterShotRecognition').ObservedPresenterRole; firstFrameRef?: string; firstFrameSeconds?: number; salesPresenterConfirmed?: boolean; environment?: string; shot: string; camera: string; visual: string; subtitle?: string; audio?: string; note?: string; purpose?: string; dialogue?: string; speechLines?: Array<{ lineId?: string; referenceText: string; draftText?: string; sourceStartSeconds: number; sourceEndSeconds: number; sourcePrecision?: 'coarse' | 'phrase'; sourceWords?: Array<{start: number; end: number; text: string}>; sourceProvenance?: string; replacedEntityTypes?: string[]; narrationOwnerShotId?: string; visualShotIds?: string[] }>; onScreenText?: string; ambientSound?: string; bgm?: string; soundEffects?: string[]; beats?: Array<{ time?: string; action?: string; dialogue?: string; onScreenText?: string }>; startState?: string; endState?: string; persistentState?: string; authenticity?: string; confidence?: number; needsReview?: boolean }[];
  };
  generatedVideo?: {
    id?: string;
    title?: string;
    url?: string;
    poster?: string;
    duration?: number;
    createdAt?: string;
    material?: Material;
    width?: number;
    height?: number;
    aspectRatio?: number;
  };
  materialRole?: 'hook';
  video?: {
    title?: string;
    referenceRecordId?: string;
    platform?: string;
    contentFormat?: 'video' | 'image';
    videoUrl?: string;
    thumbnail?: string;
    duration?: number;
    width?: number;
    height?: number;
    aspectRatio?: number;
    sourceUrl?: string;
    aiAnalysis?: {
      materialUrl?: string; materialPoster?: string; caption?: string;
      imageEvidence?: {
        version?: number;
        status?: string;
        observedFacts?: Array<Record<string, unknown>>;
        carouselFlow?: Array<Record<string, unknown>>;
        copyEvidence?: Record<string, unknown>;
        reusableModules?: Array<Record<string, unknown>>;
        uncertainties?: string[];
      };
    };
  };
}
