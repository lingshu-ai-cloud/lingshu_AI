import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const miniapp = path.join(root, 'apps/shooting-miniapp');
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const location = path.join(directory, entry.name);
    return entry.isDirectory() ? files(location) : [location];
  });
}

test('shared generation can be checked from outside the repository', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/sync-mobile-shared.mjs'), '--check'], {
    cwd: path.dirname(root), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('every native JS dependency and WXSS import is contained in the miniapp package', () => {
  for (const file of files(miniapp)) {
    const source = fs.readFileSync(file, 'utf8');
    const imports = file.endsWith('.js')
      ? [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1])
      : file.endsWith('.wxss')
        ? [...source.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map(match => match[1])
        : [];
    for (const specifier of imports) {
      if (file.endsWith('.js')) {
        assert.ok(specifier.startsWith('.'), `${file}: unexpected runtime dependency ${specifier}`);
      } else {
        assert.ok(!specifier.startsWith('/') && !specifier.includes(':'), `${file}: non-local stylesheet ${specifier}`);
      }
      const target = path.resolve(path.dirname(file), specifier);
      assert.ok(target.startsWith(miniapp + path.sep), `${file}: dependency escapes package`);
      assert.ok(fs.existsSync(target) || fs.existsSync(target + '.js'), `${file}: missing ${specifier}`);
    }
  }
});

test('native business modules load without browser, React or Node runtime dependencies', () => {
  const cache = new Map();
  function load(file) {
    if (!path.extname(file)) file += '.js';
    assert.ok(file.startsWith(miniapp + path.sep));
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const context = {
      module, exports: module.exports,
      require: specifier => load(path.resolve(path.dirname(file), specifier)),
      setTimeout, clearTimeout,
    };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    return module.exports;
  }
  const entries = [
    ...files(path.join(miniapp, 'lib')).filter(file => file.endsWith('.js')),
    path.join(miniapp, 'pages/action/model.js'),
  ];
  for (const file of entries) {
    const module = load(file);
    assert.ok(Object.keys(module).length, `${file} has no exports`);
  }
});
