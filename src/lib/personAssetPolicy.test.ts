import assert from 'node:assert/strict';
import { personIsReady, selectPerson } from './personAssetPolicy.js';

const platform = {id: 'platform', sourceType: 'platform-person', productionReady: true};
const enterprise = {id: 'enterprise', productionReady: true};
const ready = (item: {productionReady: boolean}) => item.productionReady;
assert.equal(selectPerson([enterprise, platform], '', '', ready)?.id, 'platform');
assert.equal(selectPerson([enterprise, platform], '', 'enterprise', ready)?.id, 'enterprise');
assert.equal(selectPerson([enterprise, platform], 'platform', 'enterprise', ready)?.id, 'platform');
assert.equal(selectPerson([platform], 'missing-enterprise', 'platform', ready), undefined);
assert.equal(selectPerson([platform], '', 'missing-enterprise', ready), undefined);
assert.equal(selectPerson([{...enterprise, productionReady: false}, platform], 'enterprise', '', ready), undefined);
const bound = {productionReady: true, cloudPersonReady: true};
assert.equal(personIsReady(bound), true);
for (const state of ['training', 'consent_required', 'consent_review', 'consent_submission_unknown', 'submitting', 'failed']) {
  assert.equal(personIsReady({...bound, personSetup: {state}}), false);
}
assert.equal(personIsReady({...bound, personSetup: {state: 'ready'}}), true);
assert.equal(personIsReady({productionReady: true}), false);
console.log('person identity selection and readiness tests passed');
