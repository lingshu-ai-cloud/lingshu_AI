import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repositoryRoot = process.cwd();
const roots = [
  'src/components',
  'src/lib',
  'server/digitalEmployees',
  'server/routes/digitalEmployees.ts',
  'server/socialPrograms',
  'shared',
  'apps/shooting-miniapp/lib/generated',
];
const forbiddenTerms = [
  String.fromCodePoint(0x6bcd, 0x7248),
  String.fromCodePoint(0x6bcd, 0x5185, 0x5bb9),
];
const sourceExtension = /\.(?:ts|tsx|js|mjs)$/;
const testFile = /\.(?:test|spec)\.[^.]+$/;

function collectFiles(path: string): string[] {
  const fullPath = join(repositoryRoot, path);
  if (!statSync(fullPath).isDirectory()) return [fullPath];
  return readdirSync(fullPath).flatMap(name => collectFiles(join(path, name)));
}

const exposedFiles = roots
  .flatMap(collectFiles)
  .filter(file => sourceExtension.test(file) && !testFile.test(file));
const violations = exposedFiles.filter(file => forbiddenTerms.some(term => readFileSync(file, 'utf8').includes(term)));

assert.deepEqual(violations, [], '用户可见源码不得再次出现已废弃的内部生产术语');
console.log('User-facing video terminology contract passed');
