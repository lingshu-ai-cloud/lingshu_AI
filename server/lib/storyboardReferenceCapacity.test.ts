import assert from 'node:assert/strict';
import { storyboardReferenceCapacity } from './storyboardReferenceCapacity.js';

assert.deepEqual(storyboardReferenceCapacity({ source: true, products: 1, person: true, environment: true }),
  { useProductSheet: false, usePersonEnvironmentSheet: true, referenceCount: 3, fits: true }, 'person and environment can share a role-separated reference');
assert.deepEqual(storyboardReferenceCapacity({ source: true, products: 2, person: false, environment: true }),
  { useProductSheet: true, usePersonEnvironmentSheet: false, referenceCount: 3, fits: true });
assert.deepEqual(storyboardReferenceCapacity({ source: true, products: 2, person: true, environment: true }),
  { useProductSheet: true, usePersonEnvironmentSheet: true, referenceCount: 3, fits: true });
assert.deepEqual(storyboardReferenceCapacity({ source: false, products: 0, person: false, environment: true }),
  { useProductSheet: false, usePersonEnvironmentSheet: false, referenceCount: 1, fits: true });
