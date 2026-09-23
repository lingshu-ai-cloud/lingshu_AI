import { buildSocialCrawlStrategy, type SocialSceneClusterInput } from '../../shared/socialInspirationStrategy.js';
import type { SocialAudienceRole, SocialCompanyRole, SocialCrawlStrategy } from '../../shared/contracts/socialContentWorkflow.js';

type Product = { name?: string; category?: string; highlights?: string; attributes?: Record<string, unknown> };
type Profile = {
  company?: { companyType?: string; mainMarkets?: string; primaryLanguages?: string };
  products?: { categories?: string; searchKeywords?: string; items?: Product[] };
  strategy?: { focusProducts?: string; focusMarkets?: string };
  customers?: { targetProfiles?: string; commonQuestions?: string };
  operations?: { customization?: string; leadTime?: string };
  socialStrategy?: { enabledRoutes?: string[]; routeStrategies?: Record<string, { targetBuyerRoles?: string[] }> };
};

const split = (value: string) => value.split(/[\n,，;；、]+/).map(s => s.trim()).filter(Boolean);
const meaningful = (value: string) => !/^(?:产品|商品|测试产品|示例产品|product|item|test\s*product|sample\s*product)[\s_#-]*\d*$|^\d+$|^(?:待填写|暂无|未设置)$/i.test(value.trim());
// Translation only: never add product capabilities or infer a SKU from a generic name.
const categoryEnglish: Record<string, string> = {
  '服装': 'clothing', '服饰': 'apparel', '女装': "women clothing", '男装': 'men clothing',
  '童装': 'kids clothing', '鞋': 'shoes', '鞋类': 'footwear', '箱包': 'bags',
  '家具': 'furniture', '家居': 'home decor', '灯具': 'lighting', '玩具': 'toys',
  '护肤品': 'skincare', '化妆品': 'cosmetics', '智能开关': 'smart switch',
};

export function resolveCrawlKeywords(explicit: string, profile: Profile): {
  keywords: string[]; source: 'knowledge' | 'explicit' | 'product' | 'category'; evidence: string[];
} {
  const configured = split(profile.products?.searchKeywords || '').filter(meaningful);
  if (configured.length) return { keywords: [...new Set(configured)], source: 'knowledge', evidence: configured };
  const supplied = split(explicit);
  const valid = supplied.filter(meaningful);
  if (valid.length) return { keywords: valid, source: 'explicit', evidence: valid };
  const items = profile.products?.items || [];
  const focus = supplied.length ? supplied : split(profile.strategy?.focusProducts || '');
  const selected = items.filter(item => focus.includes(String(item.name || '')));
  const candidates = selected.length ? selected : items;
  const names = candidates.map(item => item.name || '').filter(name => name && meaningful(name));
  if (names.length) return { keywords: [...new Set(names)].slice(0, 3), source: 'product', evidence: names };
  const categories = candidates.flatMap(item => split(item.category || ''));
  if (!categories.length) categories.push(...split(profile.products?.categories || ''));
  const usable = [...new Set(categories.filter(meaningful))].slice(0, 3);
  if (usable.length) return { keywords: usable.map(value => categoryEnglish[value] || value), source: 'category', evidence: usable };
  throw new Error('缺少可识别的产品名称或品类，不能使用占位名称生成采集任务。请补全企业产品资料。');
}

function first(value: string | undefined): string {
  return split(value || '')[0] || '';
}

function companyRole(profile: Profile): SocialCompanyRole {
  const value = String(profile.company?.companyType || '').toLowerCase();
  if (/工厂|制造|factory|manufacturer/.test(value)) return 'factory';
  if (/进口|import/.test(value)) return 'importer';
  if (/经销|distribut/.test(value)) return 'distributor';
  if (/零售|retail/.test(value)) return 'retailer';
  return 'brand';
}

function audienceRole(profile: Profile): SocialAudienceRole {
  const routes = profile.socialStrategy?.enabledRoutes ?? [];
  const target = [profile.customers?.targetProfiles, ...Object.values(profile.socialStrategy?.routeStrategies ?? {}).flatMap(item => item?.targetBuyerRoles ?? [])].join(' ').toLowerCase();
  if (routes.includes('consumer_retail') || /消费者|consumer/.test(target)) return 'consumer';
  if (/品牌|brand/.test(target)) return 'brand_buyer';
  if (/进口|import/.test(target)) return 'importer';
  if (/零售|retail/.test(target)) return 'retailer';
  return 'distributor';
}

function traceableSceneClusters(profile: Profile, productTask: string): SocialSceneClusterInput[] {
  const questions = split(profile.customers?.commonQuestions || '');
  return questions.slice(0, 8).map(question => ({
    label: question,
    productTask,
    demandDimension: /怎么|如何|使用|安装|清洁|教程/.test(question) ? 'scene' : 'decision_concern',
    queryVariants: [productTask, question].filter(Boolean).length === 2 ? [`${productTask} ${question}`] : [question],
    evidence: ['inquiry'],
    status: 'suggested',
  }));
}

/** Director-owned crawl plan. Existing callers may keep using the compact keyword resolver. */
export function resolveCrawlStrategy(input: {
  explicit: string;
  profile: Profile;
  platforms: string[];
  businessGoal?: string;
  now?: Date;
}): SocialCrawlStrategy {
  const selection = resolveCrawlKeywords(input.explicit, input.profile);
  const market = first(input.profile.strategy?.focusMarkets || input.profile.company?.mainMarkets);
  const language = first(input.profile.company?.primaryLanguages);
  return buildSocialCrawlStrategy({
    businessGoal: input.businessGoal?.trim() || '发现可迁移的高机会内容结构',
    productTerms: selection.keywords,
    sceneClusters: traceableSceneClusters(input.profile, selection.keywords[0] || ''),
    platforms: input.platforms,
    market,
    language,
    companyRole: companyRole(input.profile),
    audienceRole: audienceRole(input.profile),
    now: input.now,
  });
}
