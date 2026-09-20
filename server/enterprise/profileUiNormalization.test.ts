import assert from 'node:assert/strict';
import {
  normalizeEnterpriseProfile,
  profileSnapshot,
  sectionCompletion,
} from '../../src/components/EnterprisePage';

function profile(overrides: Record<string, unknown> = {}) {
  return {
    company: {
      name: '测试企业',
      industry: '',
      companyType: '',
      mainMarkets: '',
      primaryLanguages: '',
      socialPlatformExperience: '',
      founded: '',
      description: '',
    },
    socialStrategy: { enabledRoutes: [], routeStrategies: {}, manuallyEditedFields: [] },
    products: { categories: '', priceRange: '', moq: '', certifications: '', highlights: '', items: [] },
    brand: { tone: '', style: '', taboos: '', usp: '', preferredLanguages: '' },
    knowledge: '',
    ...overrides,
  } as Parameters<typeof normalizeEnterpriseProfile>[0];
}

const normalized = normalizeEnterpriseProfile(profile({
  company: {
    name: '测试企业',
    industry: '我们公司主要做工业自动化设备，服务海外客户',
    companyType: '出口型',
    mainMarkets: '主要出口拉丁美洲、北美市场',
    primaryLanguages: '英语、西班牙语',
    socialPlatformExperience: '做过 TikTok 和 YouTube',
    founded: '',
    description: '',
  },
  products: {
    categories: '工业自动化，主营伺服电机等产品',
    priceRange: '',
    moq: '',
    certifications: 'ISO 9001；CE；UKCA；we provide service',
    highlights: '',
    items: [{ name: '伺服电机', category: '工业设备', certifications: 'ISO9001；CE', images: [], videos: [], documents: [] }],
  },
}));

assert.equal(normalized.company.industry, '工业自动化与智能装备');
assert.equal(normalized.company.companyType, '出口型企业');
assert.equal(normalized.company.mainMarkets, '北美、拉美');
assert.equal(normalized.company.primaryLanguages, '英语、西班牙语');
assert.equal(normalized.company.socialPlatformExperience, '做过');
assert.equal(normalized.products.categories, '工业自动化与智能装备');
assert.equal(normalized.products.certifications, 'CE、ISO、UKCA');
assert.equal(normalized.products.items?.[0]?.category, '机械设备');
assert.equal(normalized.products.items?.[0]?.certifications, 'CE、ISO');

assert.equal(sectionCompletion(normalized).products, true, '产品事实完整时即可标记完成，不得再强制要求产品图或视频');
assert.equal(sectionCompletion(normalized).materials, true, '创作素材已迁移到“我的素材”，不得阻塞企业知识完成度');
const withImage = {
  ...normalized,
  products: {
    ...normalized.products,
    items: [{ ...normalized.products.items![0], images: [{ name: 'servo.jpg', type: 'image/jpeg', size: 1, updatedAt: new Date(0).toISOString() }] }],
  },
};
assert.equal(sectionCompletion(withImage).products, true, '历史媒体记录不得改变产品事实完成状态');
const placeholderWithMedia = {
  ...normalized,
  products: {
    ...normalized.products,
    items: [{ name: '产品1', images: [{ name: 'placeholder.jpg', type: 'image/jpeg', size: 1, updatedAt: new Date(0).toISOString() }] }],
  },
};
assert.equal(sectionCompletion(placeholderWithMedia).products, false, '占位产品名不能靠历史媒体记录反向补全产品事实');

const baseSocial = profileSnapshot(profile({
  socialStrategy: { enabledRoutes: [], routeStrategies: {}, manuallyEditedFields: [] },
}));
const toggledBack = profileSnapshot(profile({
  socialStrategy: {
    enabledRoutes: [],
    routeStrategies: { oem_odm: { targetBuyerRoles: ['采购'], primaryCta: '联系 WhatsApp' } },
    manuallyEditedFields: [],
  },
}));
assert.equal(toggledBack, baseSocial, '社媒路线打开后再关闭，不应因隐藏的路线草稿一直显示未保存');

console.log('enterprise profile UI normalization tests passed');
