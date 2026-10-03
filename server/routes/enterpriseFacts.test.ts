import assert from 'node:assert/strict';
import {
  buildEnterpriseContext,
  enterpriseFactContentHash,
  knowledgeCompletion,
  type EnterpriseProfile,
} from './enterprise.js';

const profile: EnterpriseProfile = {
  company: {
    name: '灵枢制造', industry: '工业设备', companyType: '制造商', mainMarkets: '北美',
    primaryLanguages: '英语', socialPlatformExperience: '有', founded: '2018', description: '工业设备制造商',
  },
  products: {
    categories: '工业设备', priceRange: '', moq: '10', certifications: '', highlights: '耐用',
    items: [{ name: '伺服电机', priceRange: '', images: [], certificateImages: [], documents: [] }],
  },
  brand: { name: '灵枢', tone: '', style: '', taboos: '', usp: '', preferredLanguages: '' },
  knowledge: '',
  dataGovernance: { aiAccessEnabled: true, lastSavedAt: '2026-01-01T00:00:00.000Z' },
};

const firstHash = enterpriseFactContentHash(profile);
const metadataOnlyChange: EnterpriseProfile = {
  ...profile,
  factVersion: {
    id: 'enterprise-facts-v9-old', revision: 9, contentHash: 'old',
    confirmedAt: '2026-09-01T00:00:00.000Z', confirmedBy: 'user-1',
  },
  dataGovernance: {
    ...profile.dataGovernance,
    lastSavedAt: '2026-09-02T00:00:00.000Z',
    lastSavedSource: 'enterprise_center',
    lastSavedBy: 'user-2',
  } as EnterpriseProfile['dataGovernance'] & { lastSavedBy: string },
};
assert.equal(enterpriseFactContentHash(metadataOnlyChange), firstHash, 'save metadata must not manufacture a new enterprise fact version');
assert.notEqual(
  enterpriseFactContentHash({ ...profile, products: { ...profile.products, priceRange: 'USD 100-200' } }),
  firstHash,
  'a confirmed business fact change must produce a different content hash',
);

const completion = knowledgeCompletion(profile);
assert.equal(completion.profileCompleteness.percentage, 25);
assert.deepEqual(completion.todos.map(todo => todo.kind), ['product_image', 'price', 'certificate']);
assert.equal(completion.todos[0]?.productIndex, 0);

const context = buildEnterpriseContext({ ...profile, factVersion: {
  id: 'enterprise-facts-v2-deadbeef', revision: 2, contentHash: firstHash,
  confirmedAt: '2026-09-02T00:00:00.000Z', confirmedBy: 'user-1',
} });
assert.match(context, /企业事实版本：enterprise-facts-v2-deadbeef/);

console.log('enterprise facts version and completeness tests passed');
