export type CustomerSource =
  | 'whatsapp'
  | 'facebook'
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'whatsapp_from_youtube'
  | 'whatsapp_from_tiktok'
  | 'whatsapp_from_instagram'
  | 'whatsapp_from_facebook'
  | string;
export type CustomerStage = 'lead' | 'inquiry' | 'quoted' | 'won' | 'silent30' | 'silent60';
export type HandlingMode = 'ai_auto' | 'ai_draft' | 'human_needed';
export type TimelineType = 'whatsapp' | 'call' | 'note' | 'quote' | 'task' | 'system';
export type AutonomyLevel = 'remind' | 'draft' | 'auto';

export type SalesLifecycleStage =
  | 'new_inquiry'
  | 'discovery_qualification'
  | 'technical_sample_validation'
  | 'proposal_quote'
  | 'negotiation_approval'
  | 'closed'
  | 'fulfillment_relationship';
export type DealOutcome = 'won' | 'lost' | 'on_hold';
export type EngagementStatus = 'active' | 'waiting_buyer' | 'waiting_seller' | 'dormant_30d' | 'dormant_60d';
export type KnowledgeGroundingState = 'grounded_static' | 'grounded_dynamic' | 'missing' | 'ambiguous' | 'restricted' | 'expired';
export type ExecutionMode = 'ai_auto' | 'ai_draft' | 'human_approval' | 'mandatory_handoff';

export interface SalesConversationState {
  schemaVersion: 1;
  lifecycle: {
    stage: SalesLifecycleStage;
    outcome?: DealOutcome;
    enteredAt: string;
    lastProgressedAt: string;
  };
  engagement: {
    status: EngagementStatus;
    lastActivityAt: number;
    lastBuyerMessageAt?: number;
    lastSellerMessageAt?: number;
    updatedAt: string;
  };
  intents: {
    active: Array<{ type: string; confidence: number; sourceEventIds: string[]; updatedAt: string }>;
    updatedAt: string;
  };
  dealEvidence: {
    fields: Record<string, {
      value?: string | number | boolean;
      status: 'unknown' | 'claimed' | 'verified' | 'conflicting' | 'expired';
      confidence?: number;
      sourceEventIds: string[];
      extractor?: string;
      valueRole?: 'buyer_requirement' | 'buyer_statement' | 'seller_capability' | 'transaction_fact';
      confirmedByHuman?: boolean;
      history?: Array<{ value?: string | number | boolean; status: string; sourceEventId: string; actor: string; occurredAt: string }>;
      updatedAt: string;
    }>;
    updatedAt: string;
  };
  knowledge: { state: KnowledgeGroundingState; referenceIds: string[]; updatedAt: string };
  authorityRisk: { riskLevel: 'L1' | 'L2' | 'L3' | 'L4'; executionMode: ExecutionMode; reasons: string[]; updatedAt: string };
  artifacts: {
    items: Array<{
      id: string;
      type: 'catalog' | 'specification' | 'sample' | 'quotation' | 'pi' | 'purchase_order' | 'contract' | 'payment_proof' | 'logistics' | 'claim';
      status: 'missing' | 'draft' | 'pending_approval' | 'sent' | 'accepted' | 'rejected' | 'expired';
      version: number;
      approvalStatus: 'not_required' | 'pending' | 'approved' | 'rejected';
      title?: string;
      externalRef?: string;
      approvedBy?: string;
      approvedAt?: string;
      sentAt?: string;
      expiresAt?: string;
      supersedesId?: string;
      sourceEventIds: string[];
      updatedAt: string;
    }>;
    updatedAt: string;
  };
  channelOwnership: {
    channel: string;
    owner: { type: 'ai' | 'human' | 'team' | 'unassigned'; id?: string; name?: string };
    handoffStatus: 'none' | 'requested' | 'accepted' | 'resolved';
    responseDueAt?: string;
    updatedAt: string;
  };
  revision: number;
  appliedEventIds: string[];
  updatedAt: string;
}

export interface NextBestActionDecision {
  type: 'answer_and_clarify' | 'prepare_sample' | 'prepare_quote' | 'review_negotiation' | 'request_human_takeover' | 'follow_up_buyer' | 'confirm_order_evidence' | 'support_fulfillment' | 'none';
  headline: string;
  rationale: string;
  primaryAction: string;
  answerFirst: true;
  missingConditions: string[];
  sourceEventIds: string[];
  executionMode: ExecutionMode;
}

export type AuthenticityBand = 'verified' | 'reduced' | 'suspected_scraping';
export type QualificationBand = 'white' | 'blue' | 'yellow' | 'red' | 'black';

export interface BantDimension {
  score: number;
  status: 'unknown' | 'partial' | 'confirmed';
  evidence: string[];
  signalPoints?: Record<string, number>;
}

export interface AuthenticityAssessment {
  score: number;
  band: AuthenticityBand;
  redFlags: string[];
  greenFlags: string[];
}

export interface BantAssessment {
  budget: BantDimension;
  authority: BantDimension;
  need: BantDimension;
  timing: BantDimension;
  rawTotal: number;
  authenticity: AuthenticityAssessment;
  total: number;
  band: QualificationBand;
  completeness: number;
  level: 'early' | 'qualified' | 'hot';
  evidence?: string[];
  updatedAt: string;
}

export interface ProgressionGoal {
  dimension: 'budget' | 'authority' | 'need' | 'timing';
  label: string;
  reason: string;
  question: string;
  questionStyle: 'spin_indirect';
  updatedAt: string;
}

export type SpinStage = 'situation' | 'problem' | 'implication' | 'need_payoff';

export interface SpinGuidance {
  stage: SpinStage;
  statement: string;
  question: string;
  rationale: string;
  updatedAt: string;
}

export interface TimelineEvent {
  id: string;
  type: TimelineType;
  actor: 'buyer' | 'seller' | 'ai' | 'owner';
  title: string;
  body: string;
  translatedBody?: string;
  time: string;
  timestamp?: number;
  autoSent?: boolean;
  sendStatus?: 'draft' | 'queued' | 'sent' | 'delivered' | 'failed';
  sendMode?: 'free_text' | 'template';
  confirmedByHuman?: boolean;
  audit?: {
    action?: string;
    risk?: 'L1' | 'L2' | 'L3' | 'L4';
    autonomy?: AutonomyLevel;
    guardRule?: string;
    knowledgeMiss?: boolean;
    buyerMessage?: string;
    evidence?: string[];
    editedByHuman?: boolean;
    originalDraft?: string;
    memoryApplied?: string[];
    providerMessageId?: string;
    providerRecipientId?: string;
  };
}

export interface CustomerSimulationScenario {
  checkpoint: string;
  goal: string;
  expectedBehavior: string;
  humanEditCount?: number;
  memoryApplied?: string[];
  editable?: boolean;
  warning?: {
    title: string;
    reason: string;
  };
}

export interface OrderRecord {
  id: string;
  status: 'paid' | 'refunded' | 'cancelled' | 'pending';
  total: string;
  createdAt: string;
  items?: { name: string; qty: number }[];
}

export interface CustomerProfile {
  id: string;
  name: string;
  avatar: string;
  countryName: string;
  email?: string;
  language: string;
  languageLocked: boolean;
  source: CustomerSource;
  sourcePostId?: string;
  sourceTrackCode?: string;
  sourcePostTitle?: string;
  sourcePostPlatform?: string;
  softAttribution?: {
    candidates: Array<{ id: string; title: string; platform: string; trackCode: string }>;
  };
  product: string;
  outboundProduct: string;
  estimatedValue: string;
  stage: CustomerStage;
  salesState?: SalesConversationState;
  nextBestAction?: NextBestActionDecision;
  whatsappWindow?: { status: 'open' | 'closed' | 'unknown'; closesAt?: string; templateRequired: boolean };
  intentScore: number;
  intentSignals: string[];
  bant?: BantAssessment;
  progressionGoal?: ProgressionGoal;
  spinGuidance?: SpinGuidance;
  handlingMode: HandlingMode;
  handlingReason: string;
  aiAutoCount?: number;
  needCall?: boolean;
  hasUnread?: boolean;
  isReal?: boolean;
  isMock?: boolean;
  simulation?: CustomerSimulationScenario;
  waNumber?: string;
  newProductMatch?: boolean;
  blockedAutoReplyReason?: string;
  pendingDraft?: string;
  knowledgeMissStreak?: number;
  fallbackCount?: number;
  handoffDueAt?: string;
  todoCompletedAt?: string;
  priority: number;
  inboxReason?: 'call' | 'large' | 'draft' | 'overdue' | 'reply';
  lastActive: string;
  lastActiveAt?: number;
  localTime: string;
  timeZone?: string;
  orders: OrderRecord[];
  tags: string[];
  summary: string;
  nextStep: string;
  timeline: TimelineEvent[];
}
