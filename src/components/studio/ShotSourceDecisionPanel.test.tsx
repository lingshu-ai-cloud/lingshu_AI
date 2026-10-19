import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ShotSourceDecisionPanel from './ShotSourceDecisionPanel';

const props = { onDigitalHuman() {}, onMaterials() {}, onShoot() {} };

test('shooting is absent until the canonical server route allows it', () => {
  const hidden = renderToStaticMarkup(<ShotSourceDecisionPanel {...props} />);
  assert.match(hidden, /企业素材库/);
  assert.doesNotMatch(hidden, /列入待拍清单/);
  const allowed = renderToStaticMarkup(<ShotSourceDecisionPanel {...props} allowShooting />);
  assert.match(allowed, /列入待拍清单/);
});
