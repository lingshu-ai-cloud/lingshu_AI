import type { ProductItem, Profile } from './enterpriseProfileTypes.js';

export const MARKET_OPTIONS = ['中东', '东南亚', '中亚', '南亚', '东亚', '欧洲', '北美', '拉美', '非洲', '大洋洲', '俄罗斯及独联体'];
export const LANGUAGE_OPTIONS = ['英语', '阿拉伯语', '西班牙语', '法语', '俄语', '葡萄牙语', '德语', '日语', '韩语', '土耳其语', '印地语', '印尼语', '泰语', '越南语'];
export const CATEGORY_OPTIONS = ['服装', '家居', '饰品', '五金', '美妆个护', '玩具', '消费电子', '汽摩配件', '机械设备', '工业自动化与智能装备', '包装印刷', '食品饮料', '宠物用品'];
export const COMPANY_TYPE_OPTIONS = ['工厂', '工贸一体', '贸易商', '出口型企业', '品牌商', '跨境电商'];
export const CERTIFICATION_OPTIONS = ['CE', 'FDA', 'SGS', 'RoHS', 'FCC', 'MSDS', 'ISO', 'BSCI', 'GOTS', 'OEKO-TEX'];
export function splitTokens(value?: string): string[] {
  return String(value ?? '').split(/[、,，;；\n]+/).map(item => item.trim()).filter(Boolean);
}

export function joinTokens(items: string[]): string {
  return Array.from(new Set(items.map(item => item.trim()).filter(Boolean))).join('、');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function includesKnownValue(raw: string, candidate: string): boolean {
  const source = raw.toLocaleLowerCase();
  const target = candidate.trim().toLocaleLowerCase();
  if (!target) return false;
  // 英文缩写必须是完整词，避免把 service 之类的描述文字误判成 CE 认证。
  if (/^[a-z0-9][a-z0-9 ._\-/]*$/i.test(target)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(target)}([^a-z0-9]|$)`, 'i').test(source);
  }
  return source.includes(target);
}

function isConciseLegacyOption(value: string): boolean {
  const token = value.trim();
  if (!token || token === '/' || token.length > 20) return false;
  if (/[\u3002！？!?]/.test(token)) return false;
  if (/[a-z]/.test(token) && /\s/.test(token) && token !== token.toLocaleUpperCase()) return false;
  return !/(我们|本公司|主要|主营|专注|面向|覆盖|客户|业务|产品|平台|经验|市场为|销售至|出口到)/.test(token);
}

function normalizeKnownMulti(value: string | undefined, options: string[], aliases: Record<string, string> = {}, preserveCustom = false): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const canonical: string[] = [];
  for (const option of options) {
    if (includesKnownValue(raw, option)) canonical.push(option);
  }
  for (const [legacy, replacement] of Object.entries(aliases)) {
    if (includesKnownValue(raw, legacy)) canonical.push(replacement);
  }
  const custom = preserveCustom
    ? splitTokens(raw).filter(token => {
      const hasKnownValue = options.some(option => includesKnownValue(token, option))
        || Object.keys(aliases).some(alias => includesKnownValue(token, alias));
      return !hasKnownValue && isConciseLegacyOption(token);
    })
    : [];
  return joinTokens([...canonical, ...custom]);
}

function normalizeKnownSingle(value: string | undefined, options: string[], aliases: Record<string, string> = {}, preserveCustom = false): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '/') return '';
  const alias = Object.entries(aliases).find(([legacy]) => includesKnownValue(raw, legacy));
  if (alias) return alias[1];
  const option = options.find(item => includesKnownValue(raw, item));
  if (option) return option;
  return preserveCustom && isConciseLegacyOption(raw) ? raw : '';
}

function normalizeSocialExperience(value?: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/没做过|未做过|没有|no experience/i.test(raw)) return '没做过';
  if (/准备|筹备|planning/i.test(raw)) return '正在准备';
  if (/做过|youtube|tiktok|facebook|instagram|whatsapp|linkedin/i.test(raw)) return '做过';
  return '';
}

export function normalizeEnterpriseProfile(profile: Profile): Profile {
  const items = normalizeProductItems(profile.products).map(item => ({
    ...item,
    category: normalizeKnownSingle(item.category, CATEGORY_OPTIONS, {
      工业自动化: '工业自动化与智能装备',
      自动化设备: '工业自动化与智能装备',
      工业设备: '机械设备',
      'industrial automation': '工业自动化与智能装备',
      machinery: '机械设备',
    }, true),
    certifications: normalizeKnownMulti(item.certifications, CERTIFICATION_OPTIONS, { 'iso 9001': 'ISO', iso9001: 'ISO' }, true),
  }));
  return {
    ...profile,
    company: {
      ...profile.company,
      industry: normalizeKnownMulti(profile.company.industry, CATEGORY_OPTIONS, {
        工业自动化: '工业自动化与智能装备',
        自动化设备: '工业自动化与智能装备',
        工业设备: '机械设备',
        'industrial automation': '工业自动化与智能装备',
        machinery: '机械设备',
      }, true),
      companyType: normalizeKnownSingle(profile.company.companyType, COMPANY_TYPE_OPTIONS, { 出口型: '出口型企业' }, true),
      mainMarkets: normalizeKnownMulti(profile.company.mainMarkets, MARKET_OPTIONS, {
        拉丁美洲: '拉美',
        'latin america': '拉美',
        'north america': '北美',
        'middle east': '中东',
        europe: '欧洲',
        africa: '非洲',
      }, true),
      primaryLanguages: normalizeKnownMulti(profile.company.primaryLanguages, LANGUAGE_OPTIONS, {
        english: '英语',
        spanish: '西班牙语',
        arabic: '阿拉伯语',
        french: '法语',
        russian: '俄语',
        portuguese: '葡萄牙语',
        german: '德语',
      }, true),
      socialPlatformExperience: normalizeSocialExperience(profile.company.socialPlatformExperience),
    },
    products: {
      ...profile.products,
      categories: normalizeKnownMulti(profile.products.categories, CATEGORY_OPTIONS, {
        工业自动化: '工业自动化与智能装备',
        自动化设备: '工业自动化与智能装备',
        工业设备: '机械设备',
        'industrial automation': '工业自动化与智能装备',
        machinery: '机械设备',
      }, true),
      certifications: normalizeKnownMulti(profile.products.certifications, CERTIFICATION_OPTIONS, { 'iso 9001': 'ISO', iso9001: 'ISO' }, true),
      items,
    },
  };
}

export function emptyProduct(index: number): ProductItem {
  return {
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `product-${Date.now()}-${index}`,
    name: `产品${index + 1}`,
    images: [],
    videos: [],
    documents: [],
    factoryImages: [],
    packagingImages: [],
    certificateImages: [],
    sceneImages: [],
    brandAssets: [],
  };
}

export function normalizeProductItems(products: Profile['products']): ProductItem[] {
  const existing = Array.isArray(products.items) ? products.items : [];
  if (existing.length) {
    // 编辑中的空白产品也是有效草稿；仅“删除产品”按钮可以移除产品项。
    return existing.map((item, index) => ({
      ...emptyProduct(index),
      ...item,
      name: typeof item.name === 'string' ? item.name : `产品${index + 1}`,
      images: Array.isArray(item.images) ? item.images : [],
      videos: Array.isArray(item.videos) ? item.videos : [],
      documents: Array.isArray(item.documents) ? item.documents : [],
      factoryImages: Array.isArray(item.factoryImages) && item.factoryImages.length ? item.factoryImages : (Array.isArray(item.videos) ? item.videos : []),
      packagingImages: Array.isArray(item.packagingImages) ? item.packagingImages : [],
      certificateImages: Array.isArray(item.certificateImages) && item.certificateImages.length ? item.certificateImages : (Array.isArray(item.documents) ? item.documents : []),
      sceneImages: Array.isArray(item.sceneImages) ? item.sceneImages : [],
      brandAssets: Array.isArray(item.brandAssets) ? item.brandAssets : [],
    }));
  }
  return [];
}
