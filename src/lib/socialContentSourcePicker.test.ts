import assert from 'node:assert/strict';
import type { SocialContentSourceOption } from '../../shared/contracts/socialContentWorkflow';
import { EMPTY_SOCIAL_CONTENT_DRAFT } from './socialContentModel.js';
import {
  SOCIAL_CONTENT_MAX_SOURCES_PER_TASK,
  SOCIAL_CONTENT_SOURCE_QUERY_MAX_LENGTH,
  mergeSocialContentSourceOptions,
  normalizeSocialContentSourceQuery,
  plannedSocialContentSourceCount,
  socialContentSourceLimitMessage,
  socialContentSourceOptionsAfterFailure,
} from './socialContentSourcePicker.js';

const option = (optionId: string, kind: SocialContentSourceOption['kind']): SocialContentSourceOption => ({
  optionId,
  kind,
  sourceRef: `${kind}:${optionId}`,
  sourceVersion: 'v1',
  label: optionId,
  type: kind === 'knowledge' ? 'enterprise_profile' : 'image',
  thumbnailHref: null,
});

assert.equal(SOCIAL_CONTENT_SOURCE_QUERY_MAX_LENGTH, 100);
assert.equal(normalizeSocialContentSourceQuery(`  ${'a'.repeat(120)}  `), 'a'.repeat(100));

const firstPage = [option('one', 'knowledge'), option('two', 'knowledge')];
const secondPage = [option('two', 'knowledge'), option('three', 'knowledge')];
assert.deepEqual(mergeSocialContentSourceOptions([], firstPage, 1), firstPage);
assert.deepEqual(
  mergeSocialContentSourceOptions(firstPage, secondPage, 2).map(item => item.optionId),
  ['one', 'two', 'three'],
);
assert.deepEqual(socialContentSourceOptionsAfterFailure(firstPage, 2), firstPage,
  'a later-page failure must preserve already loaded options');
assert.deepEqual(socialContentSourceOptionsAfterFailure(firstPage, 1), [],
  'a first-page failure must not leave results from an earlier query');

const existingSources = [
  { sourceId: 'existing-knowledge', kind: 'knowledge' as const, sourceRef: 'knowledge:one', status: 'active' as const },
  { sourceId: 'historical-material', kind: 'material' as const, sourceRef: 'material:old', status: 'removed' as const },
  { sourceId: 'replace-link', kind: 'reference_link' as const, sourceRef: 'https://example.com/old', status: 'active' as const },
];
const plannedDraft = {
  ...EMPTY_SOCIAL_CONTENT_DRAFT,
  removedSourceIds: ['replace-link'],
  selectedSources: [option('one', 'knowledge'), option('new', 'material'), option('new', 'material')],
  referenceLinks: ['https://example.com/old', 'https://example.com/old'],
  keyFacts: '准确的企业信息',
};
assert.equal(plannedSocialContentSourceCount(existingSources, plannedDraft, 1), 7,
  'historical rows consume capacity while duplicate planned references count once');

const fullTaskSources = Array.from({ length: SOCIAL_CONTENT_MAX_SOURCES_PER_TASK }, (_, index) => ({
  sourceId: `source-${index}`,
  kind: 'material' as const,
  sourceRef: `material:${index}`,
  status: 'active' as const,
}));
assert.equal(plannedSocialContentSourceCount(fullTaskSources, EMPTY_SOCIAL_CONTENT_DRAFT, 0), 100);
assert.equal(socialContentSourceLimitMessage(100), null);
assert.match(socialContentSourceLimitMessage(
  plannedSocialContentSourceCount(fullTaskSources, EMPTY_SOCIAL_CONTENT_DRAFT, 1),
) || '', /减少 1 项/);

console.log('social content source picker tests passed');
