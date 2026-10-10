/**
 * Provider-neutral shot routing contract.
 *
 * A vision/ASR agent supplies ShotRoutingRequirements with evidence. The
 * deterministic router chooses a production capability, while provider
 * selection remains behind the capability gate. This keeps UI state stable
 * when a provider is added, removed, or replaced by JEV scoring later.
 */

export const SHOT_ROUTING_ROUTES = [
  'presenter_talking',
  'first_frame_video',
  'product_scene_replication',
  'ugc_actor',
  'material_edit',
  'ai_broll',
] as const;
export type ShotRoutingRoute = typeof SHOT_ROUTING_ROUTES[number];

export const SHOT_ROUTING_SHOT_TYPES = [
  'enterprise_presenter',
  'ugc_actor',
  'product_close_up',
  'factory_operation',
  'usage_scene',
  'information_card',
  'transition_atmosphere',
] as const;
export type ShotRoutingShotType = typeof SHOT_ROUTING_SHOT_TYPES[number];

export type ShotIdentityRequirement = 'enterprise_presenter' | 'industry_role' | 'none';
export type ShotProductIdentityRequirement = 'locked_product' | 'generic_product' | 'none';
export type ShotSpeechRequirement = 'precise_lip_sync' | 'voiceover_ok' | 'none';
export type ShotBackgroundRequirement = 'preserve_composition' | 'preserve_scene' | 'flexible';
export type ShotMotionRequirement = 'authorized_reference_motion' | 'light_gesture' | 'none';
export type ShotReferenceUse = 'structure_only' | 'first_frame_composition' | 'authorized_motion_input';

/** Source evidence must be retained with the agent's interpretation. */
export interface ShotRoutingEvidence {
  sourceRange?: { startSeconds: number; endSeconds: number };
  keyframeIds: string[];
  asrText?: string;
  materialIds: string[];
}

/** Independent confidences make an uncertain field visible to the UI. */
export interface ShotRoutingConfidence {
  shotType: number;
  identity: number;
  speech: number;
  background: number;
  motion: number;
}

/** Structured output of the shot-understanding Agent; it must not name a model. */
export interface ShotRoutingRequirements {
  shotType: ShotRoutingShotType;
  visualRole: string;
  identityRequirement: ShotIdentityRequirement;
  productIdentityRequirement: ShotProductIdentityRequirement;
  speechRequirement: ShotSpeechRequirement;
  backgroundRequirement: ShotBackgroundRequirement;
  motionRequirement: ShotMotionRequirement;
  referenceUse: ShotReferenceUse;
  durationSeconds: number | null;
  evidence: ShotRoutingEvidence;
  confidence: ShotRoutingConfidence;
}

/** Facts checked by the deterministic asset, rights, budget and runtime gate. */
export interface ShotRoutingAvailability {
  enterprisePresenterReady: boolean;
  enterprisePresenterImageReady: boolean;
  presenterTalkingAvailable: boolean;
  firstFrameVideoAvailable: boolean;
  productSceneReplicationAvailable: boolean;
  productIdentityReferencesReady: boolean;
  accountPresenterProfileConsistent: boolean;
  ugcActorAvailable: boolean;
  materialEditAvailable: boolean;
  aiBrollAvailable: boolean;
  authorizedReferenceMotion: boolean;
  budgetAvailable: boolean;
}

export type ShotRoutingStatus = 'ready' | 'needs_input' | 'blocked';

/**
 * Stable decision returned to the storyboard UI. `route` expresses the
 * recommended capability rather than a supplier. `executable` is false until
 * all non-negotiable gates are true.
 */
export interface ShotRoutingDecision {
  route: ShotRoutingRoute;
  fallbackRoutes: ShotRoutingRoute[];
  confidence: number;
  reasons: string[];
  requiresUserConfirmation: boolean;
  status: ShotRoutingStatus;
  executable: boolean;
  blockers: string[];
  requiredCapabilities: string[];
  evidence: ShotRoutingEvidence;
}
