import assert from 'node:assert/strict';
import { matchStoryboardNamedPersonImage, storyboardNamedPersonConsentReady, storyboardNamedPersonRequired } from './storyboardNamedPersonReference';

const rightsEvidence = { authorizationRef: 'document://test', consentRef: 'consent://test', grantedAt: '2025-01-01T00:00:00.000Z',
  subjectAdultConfirmed: true, providerScopes: [{ provider: 'dashscope', uses: ['person_replacement', 'quality_inspection'] }] };
const people = [
  { name: '小陈', authorized: true, referenceMaterialIds: ['person-1'], rightsEvidence },
  { name: '小李', authorized: true, referenceMaterialIds: ['person-2'], rightsEvidence },
];
const images = new Set(['person-1', 'person-2']);
assert.equal(matchStoryboardNamedPersonImage('小陈在工厂手持产品', people, images), 'person-1');
assert.equal(matchStoryboardNamedPersonImage('工人操作流水线', people, images), undefined);
assert.equal(storyboardNamedPersonRequired('工人操作流水线', people), false);
assert.equal(storyboardNamedPersonRequired('小陈在工厂手持产品', people), true);
assert.equal(matchStoryboardNamedPersonImage('企业人物在工厂手持产品', people, images), undefined);
assert.equal(matchStoryboardNamedPersonImage('指定人物在工厂手持产品', [people[0]], images), 'person-1');
assert.equal(matchStoryboardNamedPersonImage('指定人物在工厂手持产品', [{ ...people[0], authorized: false }], images), undefined);
assert.equal(matchStoryboardNamedPersonImage('小陈在工厂手持产品', people, new Set(['person-2'])), undefined);
assert.equal(storyboardNamedPersonConsentReady({ ...people[0], rightsEvidence: { ...rightsEvidence, revokedAt: '2026-01-01' } }), false);
assert.equal(storyboardNamedPersonConsentReady({ ...people[0], rightsEvidence: { ...rightsEvidence,
  providerScopes: [{ provider: 'dashscope', uses: ['person_replacement'] }] } }), false);
console.log('storyboardNamedPersonReference tests passed');
