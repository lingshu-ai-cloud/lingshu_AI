export interface DigitalHumanReferenceCue {
  id: string;
  start: number;
  end: number;
  originalText: string;
  targetText: string;
  shotIds: string[];
  /** Manual physical-shot split: both source wording and person speech must be reassigned. */
  splitFromCueId?: string;
  /** Only person shots enter the paid first-frame replacement chain. */
  personShot?: boolean;
  classificationSource?: 'analysis' | 'manual';
  composition?: { presenterKey: string; shotSize: string; cameraAngle: string; background: string; actionIntent: string };
  compositionClusterId?: string;
  /** Tenant-owned replacement footage for product/factory/B-roll cues. */
  nonPersonMaterialId?: string;
  /** The source frame is extracted locally for structure/composition analysis. */
  sourceFirstFrame?: { time: number; materialId?: string; imageUrl?: string };
  /** The rebuilt frame contains the selected enterprise presenter and becomes video input. */
  targetFirstFrame?: { materialId?: string; imageUrl?: string; state: 'pending' | 'ready' | 'failed' };
  /** Optional paid Qwen composition draft. It is never used as Seedance input without a separate final-frame step. */
  draftFirstFrame?: { provider: 'qwen'; materialId: string; imageUrl?: string; state: 'ready'; estimatedCostCny: number };
  generatedClip?: { materialId?: string; videoUrl?: string; state: 'pending' | 'ready' | 'failed'; duration?: number };
}

/** Provider-independent requirements shared by the editor and server admission checks. */
export interface DigitalHumanRequirements {
  targetFramesConfirmed?: boolean;
  presenterMode?: 'video_twin' | 'photo_talking';
  workflow: 'material_processing' | 'viral_replication';
  method: 'talking' | 'replace' | 'reenact';
  preferredProvider?: 'auto' | 'kling' | 'sd' | 'runway' | 'self_hosted';
  /** Viral reenactment defaults to local sentence/frame decomposition; direct reference is opt-in. */
  replicationMode?: 'sentence_first_frame' | 'direct_reference';
  presenterSelected?: boolean;
  replacementScope?: 'face_only' | 'person_keep_scene' | 'person_and_scene';
  targetEffect?: 'natural_talking' | 'reference_motion' | 'flexible_scene';
  contentConfirmed: boolean;
  action: string;
  scene: string;
  preserve: string;
  reference?: {
    materialId?: string;
    videoUrl: string;
    start: number;
    end: number;
    originalText: string;
    derivativeAuthorized: boolean;
    derivativeAuthorizationEvidence?: string;
    modelInputAuthorized?: boolean;
    modelInputAuthorizationEvidence?: string;
    cues?: DigitalHumanReferenceCue[];
  };
}
