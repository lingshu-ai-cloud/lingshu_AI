import type { ProductItem, Profile } from './enterpriseProfileTypes.js';
import { normalizeProductItems } from './enterpriseProfileNormalization.js';

type SectionKey = 'products' | 'materials' | 'bizRules' | 'faq' | 'market' | 'company';
export type EnterpriseCompletenessTodo = {
  id: string;
  kind: 'product_image' | 'price' | 'certificate' | 'market';
  label: string;
  description: string;
  view: 'products' | 'company';
  productIndex?: number;
};


export function productCreativeMaterialCount(product: ProductItem): number {
  const assets = [
    ...(product.images ?? []),
    ...(product.videos ?? []),
    ...(product.factoryImages ?? []),
    ...(product.packagingImages ?? []),
    ...(product.sceneImages ?? []),
    ...(product.brandAssets ?? []),
  ];
  const signatures = new Set(assets.map(asset => asset.url || `${asset.name}:${asset.size}:${asset.updatedAt}`));
  if (product.imageUrl) signatures.add(product.imageUrl);
  return signatures.size;
}

export function productAssetStats(items: ProductItem[]) {
  return items.reduce((acc, product) => {
    acc.creative += productCreativeMaterialCount(product);
    acc.documents += product.documents?.length ?? 0;
    return acc;
  }, { creative: 0, documents: 0 });
}

export function sectionCompletion(profile: Profile): Record<SectionKey, boolean> {
  const items = normalizeProductItems(profile.products);
  const namedProducts = items.filter((item, index) => Boolean(item.name.trim() && item.name.trim() !== `产品${index + 1}`));
  return {
    products: namedProducts.length > 0,
    // 创作素材在“我的素材”独立维护，不再作为企业事实资料的完成门槛。
    materials: true,
    bizRules: Boolean(profile.bizRules?.quoteMode && profile.bizRules?.samplePolicy?.trim() && profile.bizRules?.paymentTerms?.trim()),
    faq: (profile.faq ?? []).length >= 5,
    market: Boolean(profile.company.mainMarkets.trim() && profile.company.primaryLanguages?.trim()),
    company: Boolean(profile.company.name.trim() && profile.company.industry.trim() && profile.company.companyType?.trim()),
  };
}

export function enterpriseProfileCompleteness(profile: Profile): {
  percentage: number;
  completed: number;
  total: 4;
  todos: EnterpriseCompletenessTodo[];
} {
  const namedProducts = normalizeProductItems(profile.products)
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => Boolean(item.name.trim() && item.name.trim() !== `产品${index + 1}`));
  const missingImage = namedProducts.find(({ item }) => !(item.imageUrl?.trim() || (item.images?.length ?? 0) > 0));
  const missingPrice = namedProducts.find(({ item }) => !(item.priceRange?.trim() || item.retailPrice?.trim() || item.tagPrice?.trim()));
  const missingCertificate = namedProducts.find(({ item }) => !(
    item.certifications?.trim() || (item.certificateImages?.length ?? 0) > 0 || (item.documents?.length ?? 0) > 0
  ));
  const imageReady = namedProducts.length > 0 && !missingImage;
  const priceReady = Boolean(profile.products.priceRange.trim() || profile.bizRules?.priceRange?.trim())
    || (namedProducts.length > 0 && !missingPrice);
  const certificateReady = Boolean(profile.products.certifications.trim())
    || (namedProducts.length > 0 && !missingCertificate);
  const marketReady = Boolean(profile.company.mainMarkets.trim() && profile.company.primaryLanguages?.trim());
  const todos: EnterpriseCompletenessTodo[] = [];
  if (!imageReady) todos.push({ id: `image-${missingImage?.index ?? 0}`, kind: 'product_image', label: '补产品图', description: missingImage?.item.name ? `${missingImage.item.name} 缺少产品图` : '先添加产品并上传产品图', view: 'products', ...(missingImage ? { productIndex: missingImage.index } : {}) });
  if (!priceReady) todos.push({ id: `price-${missingPrice?.index ?? 0}`, kind: 'price', label: '补价格', description: missingPrice?.item.name ? `${missingPrice.item.name} 缺少参考价格` : '补充产品或内部参考价格', view: 'products', ...(missingPrice ? { productIndex: missingPrice.index } : {}) });
  if (!certificateReady) todos.push({ id: `certificate-${missingCertificate?.index ?? 0}`, kind: 'certificate', label: '补证书', description: missingCertificate?.item.name ? `${missingCertificate.item.name} 缺少认证或资质凭证` : '补充认证或上传资质凭证', view: 'products', ...(missingCertificate ? { productIndex: missingCertificate.index } : {}) });
  if (!marketReady) todos.push({ id: 'market', kind: 'market', label: '补市场信息', description: '补充目标市场和主要沟通语言', view: 'company' });
  const completed = 4 - todos.length;
  return { percentage: completed * 25, completed, total: 4, todos };
}
