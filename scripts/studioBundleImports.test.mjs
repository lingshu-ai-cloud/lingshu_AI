import assert from 'node:assert/strict';
import test from 'node:test';
import { studioEntryImportPath } from './studioBundleImports.mjs';

function inspect(sources) {
  const reads = new Map();
  const chain = studioEntryImportPath({ chunks: Object.keys(sources), from: 'views.js', entry: 'entry.js',
    readSource: name => { reads.set(name, (reads.get(name) || 0) + 1); return sources[name]; } });
  return { chain, reads };
}

test('view imports may use shared support and lazily open the entry without initializing it', () => {
  assert.equal(inspect({ 'views.js': 'import "./support.js"; const open = () => import("./entry.js");',
    'support.js': 'export const font = "sans";', 'entry.js': 'import "./views.js";' }).chain, null);
});

test('both a direct import and a re-export reveal the actual entry dependency', () => {
  for (const source of ['import { main } from "./entry.js";', 'export { main } from "./entry.js";']) {
    assert.deepEqual(inspect({ 'views.js': source, 'entry.js': 'export const main = 1;' }).chain, ['views.js', 'entry.js']);
  }
});

test('support and icon placement cannot hide an indirect import of the entry', () => {
  assert.deepEqual(inspect({ 'views.js': 'import "./support.js";', 'support.js': 'import "./icons.js";',
    'icons.js': 'import "./entry.js";', 'entry.js': 'import "./views.js";' }).chain,
  ['views.js', 'support.js', 'icons.js', 'entry.js']);
});

test('unrelated support cycles terminate and external specifiers never become local chunk reads', () => {
  const result = inspect({ 'views.js': 'import "./a.js"; import "entry.js";',
    'a.js': 'import "./b.js";', 'b.js': 'import "./a.js";', 'entry.js': 'export {};' });
  assert.equal(result.chain, null);
  assert.equal(result.reads.has('entry.js'), false);
  assert.ok([...result.reads.values()].every(count => count === 1));
});
