import type { TenantFaqPackOverrides } from '../../../shared/contracts/tenantFaqPacks.js';
import type { ProductScenePreparationPlan } from '../../../shared/contracts/productScenePreparation.js';

export interface ProductAsset {
  name: string;
  type: string;
  size: number;
  updatedAt: string;
  url?: string;
}

export interface ProductItem {
  id?: string;
  productId?: string;
  sku?: string;
  name: string;
  category?: string;
  color?: string;
  size?: string;
  tagPrice?: string;
  retailPrice?: string;
  brand?: string;
  material?: string;
  imageUrl?: string;
  priceRange?: string;
  moq?: string;
  samplePolicy?: string;
  paymentTerms?: string;
  leadTime?: string;
  customization?: string;
  certifications?: string;
  highlights?: string;
  images?: ProductAsset[];
  videos?: ProductAsset[];
  documents?: ProductAsset[];
  factoryImages?: ProductAsset[];
  packagingImages?: ProductAsset[];
  certificateImages?: ProductAsset[];
  sceneImages?: ProductAsset[];
  brandAssets?: ProductAsset[];
  productScenePreparation?: ProductScenePreparationPlan;
}

export type AutonomyLevel = 'remind' | 'draft' | 'auto';
export type QuoteMode = '' | 'range' | 'human_only';
export type BargainPolicy = '' | 'no' | 'limited' | 'open';
export type NotificationChannel = 'wecom' | 'dingtalk' | 'feishu' | 'sms';

export interface BizRules {
  quoteMode: QuoteMode;
  priceRange?: string;
  bargainPolicy: BargainPolicy;
  bargainFloor?: string;
  moq: string;
  samplePolicy: string;
  paymentTerms: string;
  leadTime: string;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  approvedForAuto: boolean;
  source?: 'manual' | 'pack' | 'learned';
}

export interface FaqPackItem {
  q: string;
  a: string;
  vars: string[];
  missingVars: string[];
  ready: boolean;
  exists?: boolean;
}

export interface FaqPack {
  customized?: boolean;
  id: string;
  industry: 'apparel' | 'home' | 'general';
  industryLabel: string;
  scenario: 'presales' | 'shipping' | 'aftersales' | 'credentials';
  scenarioLabel: string;
  count: number;
  preview: FaqPackItem[];
  items: FaqPackItem[];
}

export interface NotificationReceiver {
  name: string;
  channel: NotificationChannel;
  target: string;
}

export interface NotificationSettings {
  receivers: NotificationReceiver[];
  workHours: { start: string; end: string };
  quietOutsideHours: boolean;
  nightMode: { enabled: boolean; autoCategories: 'approved' };
  lastTestAt?: string;
}

export interface HandoffRules {
  keywords: string[];
  missStreakToDraft: 1 | 2 | 3;
  negativeSentiment: boolean;
}

export interface SalesStyleProfile {
  learnedFromCount: number;
  lastDistilledAt?: string;
  greeting_style?: { value: string; evidence: string; manual?: boolean };
  quoting_stance?: { value: string; evidence: string; manual?: boolean };
  followup_rhythm?: { value: string; evidence: string; manual?: boolean };
  taboo_phrases?: { value: string[]; evidence: string; manual?: boolean };
  sample_pairs?: Array<{ trigger: string; final: string; evidence?: string }>;
}

export interface CustomerServiceSettings {
  enabled: boolean;
  enabledAt?: string;
  disabledAt?: string;
  partialAutoReplyEnabled: boolean;
  partialAutoReplyDecision: 'pending' | 'enabled' | 'declined';
  partialAutoReplyDecisionAt?: string;
}

export type CooperationRoute = 'oem_odm' | 'wholesale_distribution' | 'consumer_retail';
export type SocialStrategy = { enabledRoutes: CooperationRoute[]; routeStrategies: Partial<Record<CooperationRoute, { targetBuyerRoles: string[]; primaryCta: string }>>; manuallyEditedFields?: string[] };

export interface Profile {
  faqPackOverrides?: TenantFaqPackOverrides;
  factVersion?: { id: string; revision: number; contentHash: string; confirmedAt: string; confirmedBy: string };
  company: { name: string; industry: string; companyType?: string; primaryBusiness?: string; capabilities?: string; certifications?: string; credentialEvidence?: string; mainMarkets: string; primaryLanguages?: string; socialPlatformExperience?: string; founded: string; description: string };
  socialStrategy?: SocialStrategy;
  products: { categories: string; searchKeywords?: string; priceRange: string; moq: string; certifications: string; highlights: string; items?: ProductItem[] };
  brand: { name?: string; tone: string; style: string; taboos: string; usp: string; preferredLanguages?: string };
  strategy?: { currentGoal?: string; focusProducts?: string; focusMarkets?: string; excludedMarkets?: string; pricingStrategy?: string; minMargin?: string; agentAutonomy?: string; aiAutonomy?: AutonomyLevel };
  customers?: { targetProfiles?: string; highValueSignals?: string; lowQualitySignals?: string; commonQuestions?: string; followupStyle?: string };
  operations?: { leadTime?: string; customization?: string; logistics?: string; paymentTerms?: string; riskNotes?: string };
  agentLearning?: { provenAngles?: string; weakAngles?: string; pendingAssumptions?: string; userCorrections?: string };
  bizRules?: BizRules;
  faq?: FaqItem[];
  notifications?: NotificationSettings;
  handoffRules?: HandoffRules;
  customerService?: CustomerServiceSettings;
  salesStyleProfile?: SalesStyleProfile;
  knowledgeIntake?: { lastExtractedAt?: string; source?: 'history' | 'products' | 'interview'; extractedMessages?: number; confirmedSections?: string[] };
  dataGovernance?: { aiAccessEnabled: boolean; lastSavedAt?: string; lastSavedSource?: 'diagnosis' | 'enterprise_center' | 'knowledge_intake' | 'system' | 'template' };
  knowledge: string;
}
