import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeProfile, verifyEnterpriseFactContent } from './enterpriseProfileStore.js';
import {
  buildEnterpriseContext,
  enterpriseFactContentHash,
  knowledgeCompletion,
  type EnterpriseProfile,
} from './enterprise.js';
import { ensureProductScenePreparationPlan } from '../../shared/contracts/productScenePreparation.js';

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
assert.equal(enterpriseFactContentHash({
  ...profile,
  products: {
    ...profile.products,
    items: profile.products.items?.map((item, index) => ({
      ...item,
      productScenePreparation: ensureProductScenePreparationPlan(item.id || item.productId || item.sku || `product-${index}`),
    })),
  },
}), firstHash, 'product scene preparation plans are operational metadata and must not change the enterprise fact hash');
assert.notEqual(
  enterpriseFactContentHash({ ...profile, products: { ...profile.products, priceRange: 'USD 100-200' } }),
  firstHash,
  'a confirmed business fact change must produce a different content hash',
);

const historical = normalizeProfile(profile);
const historicalOnboarding = historical.digitalEmployeeOnboarding as Record<string, unknown>;
delete historicalOnboarding.confirmationId;
delete historicalOnboarding.confirmationDigest;
delete historicalOnboarding.completedAt;
delete (historical.socialStrategy as Record<string, unknown>).primaryPlatforms;
function oldStable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(oldStable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !['factVersion', 'lastSavedAt', 'lastSavedSource', 'lastSavedBy', 'productScenePreparation'].includes(key))
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${oldStable(child)}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
const oldHash = createHash('sha256').update(oldStable(historical)).digest('hex');
const oldConfirmed = { ...profile, factVersion: { id: 'legacy', revision: 1, contentHash: oldHash,
  confirmedAt: '2026-10-01T00:00:00Z', confirmedBy: 'user-1' } };
assert.equal(verifyEnterpriseFactContent(oldConfirmed).mode, 'legacy_onboarding_defaults');
assert.equal(verifyEnterpriseFactContent({ ...oldConfirmed, company: { ...oldConfirmed.company, name: 'Changed' } }).verified, false);
assert.equal(verifyEnterpriseFactContent({ ...oldConfirmed, socialStrategy: { ...normalizeProfile(profile).socialStrategy!, primaryPlatforms: ['facebook'] } }).verified, false);

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
