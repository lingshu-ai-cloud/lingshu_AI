import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
const scripts = packageJson.scripts ?? {};
const discovered = new Set<string>();

function walk(directory: string): void {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (/\.test\.(?:ts|tsx|js|cjs)$/.test(entry.name)) {
      discovered.add(path.relative(root, absolute).split(path.sep).join('/'));
    }
  }
}

for (const directory of ['server', 'src', 'scripts', 'desktop']) walk(path.join(root, directory));

const included = new Set<string>();
function inspectScript(name: string, stack: string[] = []): void {
  if (stack.includes(name)) throw new Error(`recursive npm script: ${[...stack, name].join(' -> ')}`);
  const command = scripts[name] || '';
  for (const token of command.split(/\s+/)) {
    const normalized = token.replace(/^["']|["']$/g, '');
    if (/\.test\.(?:ts|tsx|js|cjs)$/.test(normalized)) included.add(normalized);
  }
  for (const match of command.matchAll(/npm run (test:[\w-]+)/g)) {
    inspectScript(match[1], [...stack, name]);
  }
}

inspectScript('test');
const missing = [...discovered].filter(file => !included.has(file)).sort();
assert.deepEqual(missing, [], `npm test does not include:\n${missing.join('\n')}`);
console.log(`npm test includes all ${discovered.size} discovered regression files`);
