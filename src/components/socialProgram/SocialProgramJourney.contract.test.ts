import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvePage } from '../../pageRegistry.js';

const layout = readFileSync(new URL('../Layout.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');

assert.doesNotMatch(layout, /SOCIAL_PROGRAM_NAV|navItem\('socialWorkspace'/,
  'the removed workbench must not reappear in the sidebar');
assert.doesNotMatch(app, /page === 'socialWorkspace' &&/,
  'the removed workbench must not be rendered as a page');
assert.equal(resolvePage('socialWorkspace'), 'digitalEmployees');
assert.equal(resolvePage('socialSetup'), 'digitalEmployees');
assert.equal(resolvePage('socialPlanning'), 'digitalEmployees');
assert.equal(resolvePage('socialAccounts'), 'traffic');

console.log('removed social workbench navigation and legacy route compatibility passed');
