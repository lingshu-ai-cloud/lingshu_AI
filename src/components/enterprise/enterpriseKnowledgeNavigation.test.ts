import assert from 'node:assert/strict';
import test from 'node:test';
import { enterpriseAreaForView, KNOWLEDGE_AREAS, normalizeKnowledgeView } from './enterpriseKnowledgeNavigation';
import { knowledgeReviewItems } from './EnterpriseKnowledgeSummary';
import { DEFAULT } from './enterpriseProfileState';
import { normalizeProfile } from '../../../server/routes/enterpriseProfileStore';
import type { EnterpriseProfile } from '../../../server/routes/enterpriseProfileContracts';

test('legacy task, language, FAQ and presenter deep links reach the correct area', () => {
  assert.ok(KNOWLEDGE_AREAS.some(area => area.key === 'appearance' && area.label === '数字人'));
  for (const [legacy, view, area] of [
    ['materials', 'products', 'products'], ['socialStrategy', 'market', 'market'],
    ['language-settings', 'market', 'market'], ['faq', 'faq', 'experience'],
    ['advanced', 'advanced', 'settings'], ['presenterRouting', 'presenters', 'appearance'],
  ] as const) {
    assert.equal(normalizeKnowledgeView(legacy), view);
    assert.equal(enterpriseAreaForView(normalizeKnowledgeView(legacy)), area);
  }
  assert.equal(normalizeKnowledgeView('bad-route'), 'company');
});
test('initial review never requires price, certificates, material uploads or a digital human', () => {
  const established = { ...DEFAULT, company: { ...DEFAULT.company, name: '企业', industry: '机械设备', companyType: '工厂' }, products: { ...DEFAULT.products, items: [{ name: '设备' }] } };
  assert.deepEqual(knowledgeReviewItems(established), []);
  assert.deepEqual(knowledgeReviewItems({ ...established, faq: [{ id: 'q', question: '交期多久', answer: '', approvedForAuto: false }], agentLearning: { pendingAssumptions: '待核实' } }).map(item => item.view), ['faq', 'learning']);
});
test('company evidence and product exceptions survive normalization without changing absent legacy keys', () => {
  const old = normalizeProfile(DEFAULT as EnterpriseProfile);
  assert.equal(Object.hasOwn(old.company, 'credentialEvidence'), false);
  const next = normalizeProfile({ ...old, company: { ...old.company, capabilities: '质检', certifications: '企业证书', credentialEvidence: '证书 A，有效期见原件' }, products: { ...old.products, items: [{ name: '设备', samplePolicy: '此型号样品另议', leadTime: '此型号交期需核实' }] } });
  assert.equal(next.company.credentialEvidence, '证书 A，有效期见原件');
  assert.equal(next.products.items?.[0]?.samplePolicy, '此型号样品另议');
  assert.equal(next.products.items?.[0]?.leadTime, '此型号交期需核实');
});
