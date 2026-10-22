import type { CooperationRoute, Profile, SocialStrategy } from './enterpriseProfileTypes';
import { normalizeEnterpriseProfile, normalizeProductItems } from './enterpriseProfileNormalization';

export const DEFAULT: Profile = {
  company: { name: '', industry: '', companyType: '', mainMarkets: '', primaryLanguages: '', socialPlatformExperience: '', founded: '', description: '' },
  socialStrategy: { enabledRoutes: [], routeStrategies: {}, manuallyEditedFields: [] },
  products: {
    categories: '',
    priceRange: '',
    moq: '',
    certifications: '',
    highlights: '',
    items: [],
  },
  brand: { name: '', tone: '', style: '', taboos: '', usp: '', preferredLanguages: '' },
  strategy: { currentGoal: '', focusProducts: '', focusMarkets: '', excludedMarkets: '', pricingStrategy: '', minMargin: '', agentAutonomy: '', aiAutonomy: 'draft' },
  customers: { targetProfiles: '', highValueSignals: '', lowQualitySignals: '', commonQuestions: '', followupStyle: '' },
  operations: { leadTime: '', customization: '', logistics: '', paymentTerms: '', riskNotes: '' },
  agentLearning: { provenAngles: '', weakAngles: '', pendingAssumptions: '', userCorrections: '' },
  bizRules: { quoteMode: 'human_only', priceRange: '', bargainPolicy: 'no', bargainFloor: '', moq: '', samplePolicy: '', paymentTerms: '', leadTime: '' },
  faq: [],
  notifications: { receivers: [], workHours: { start: '09:00', end: '22:00' }, quietOutsideHours: true, nightMode: { enabled: false, autoCategories: 'approved' }, lastTestAt: '' },
  handoffRules: { keywords: ['人工', '老板', 'manager', 'complaint', 'refund'], missStreakToDraft: 2, negativeSentiment: true },
  customerService: { enabled: false, enabledAt: '', disabledAt: '', partialAutoReplyEnabled: false, partialAutoReplyDecision: 'pending', partialAutoReplyDecisionAt: '' },
  salesStyleProfile: { learnedFromCount: 0, sample_pairs: [] },
  knowledge: '',
};

export function profileSnapshot(profile: Profile): string {
  const stable = JSON.parse(JSON.stringify(profile)) as Profile;
  const enabledRoutes = Array.from(new Set(stable.socialStrategy?.enabledRoutes ?? [])).sort() as CooperationRoute[];
  const routeStrategies = Object.fromEntries(
    enabledRoutes
      .filter(route => Boolean(stable.socialStrategy?.routeStrategies?.[route]))
      .map(route => [route, stable.socialStrategy!.routeStrategies[route]]),
  ) as SocialStrategy['routeStrategies'];
  stable.socialStrategy = { ...(stable.socialStrategy ?? DEFAULT.socialStrategy!), enabledRoutes, routeStrategies };
  return JSON.stringify(stable);
}

export function hydrateEnterpriseProfile(data: Partial<Profile>): Profile {
  const rawNext: Profile = {
    ...DEFAULT,
    ...data,
    company: { ...DEFAULT.company, ...data.company },
    socialStrategy: {
      ...DEFAULT.socialStrategy!,
      ...data.socialStrategy,
      routeStrategies: { ...DEFAULT.socialStrategy!.routeStrategies, ...data.socialStrategy?.routeStrategies },
    },
    products: { ...DEFAULT.products, ...data.products, items: normalizeProductItems({ ...DEFAULT.products, ...data.products }) },
    brand: { ...DEFAULT.brand, ...data.brand },
    strategy: { ...DEFAULT.strategy, ...data.strategy },
    customers: { ...DEFAULT.customers, ...data.customers },
    operations: { ...DEFAULT.operations, ...data.operations },
    agentLearning: { ...DEFAULT.agentLearning, ...data.agentLearning },
    bizRules: {
      ...DEFAULT.bizRules,
      ...data.bizRules,
      quoteMode: data.bizRules?.quoteMode ?? DEFAULT.bizRules!.quoteMode,
      bargainPolicy: data.bizRules?.bargainPolicy ?? DEFAULT.bizRules!.bargainPolicy,
      priceRange: data.bizRules?.priceRange || data.products?.priceRange || '',
      moq: data.bizRules?.moq || data.products?.moq || '',
      samplePolicy: data.bizRules?.samplePolicy ?? '',
      paymentTerms: data.bizRules?.paymentTerms || data.operations?.paymentTerms || '',
      leadTime: data.bizRules?.leadTime || data.operations?.leadTime || '',
    },
    faq: Array.isArray(data.faq) ? data.faq : [],
    notifications: {
      ...DEFAULT.notifications!,
      ...data.notifications,
      workHours: { ...DEFAULT.notifications!.workHours, ...data.notifications?.workHours },
      nightMode: {
        enabled: Boolean(data.notifications?.nightMode?.enabled),
        autoCategories: 'approved',
      },
      receivers: Array.isArray(data.notifications?.receivers) ? data.notifications!.receivers : [],
    },
    handoffRules: {
      ...DEFAULT.handoffRules!,
      ...data.handoffRules,
      keywords: Array.isArray(data.handoffRules?.keywords) && data.handoffRules.keywords.length
        ? data.handoffRules.keywords
        : DEFAULT.handoffRules!.keywords,
      missStreakToDraft: [1, 2, 3].includes(Number(data.handoffRules?.missStreakToDraft))
        ? data.handoffRules!.missStreakToDraft
        : DEFAULT.handoffRules!.missStreakToDraft,
      negativeSentiment: data.handoffRules?.negativeSentiment !== false,
    },
    customerService: {
      ...DEFAULT.customerService!,
      ...data.customerService,
      enabled: data.customerService?.enabled === true,
      partialAutoReplyEnabled: data.customerService?.partialAutoReplyEnabled === true,
      partialAutoReplyDecision: data.customerService?.partialAutoReplyDecision === 'enabled' || data.customerService?.partialAutoReplyDecision === 'declined'
        ? data.customerService.partialAutoReplyDecision
        : 'pending',
    },
    salesStyleProfile: {
      ...DEFAULT.salesStyleProfile!,
      ...data.salesStyleProfile,
      sample_pairs: Array.isArray(data.salesStyleProfile?.sample_pairs) ? data.salesStyleProfile.sample_pairs : [],
    },
    knowledge: data.knowledge ?? '',
  };
  return normalizeEnterpriseProfile(rawNext);
}
