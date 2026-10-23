import fs from 'node:fs';
import path from 'node:path';
import { studioEntryImportPath } from './studioBundleImports.mjs';

const assetsDir = path.resolve('dist/assets');
const maxBytes = 485_000;

if (!fs.existsSync(assetsDir)) {
  throw new Error('Production assets are missing; run pnpm run build first.');
}

const chunks = fs.readdirSync(assetsDir).filter(name => /^AiCreateStudio-[\w-]+\.js$/.test(name));
if (chunks.length !== 1) {
  throw new Error(`Expected one AiCreateStudio production chunk, found ${chunks.length}.`);
}

const bytes = fs.statSync(path.join(assetsDir, chunks[0])).size;
if (bytes > maxBytes) {
  throw new Error(`AiCreateStudio chunk is ${bytes} bytes, above the ${maxBytes}-byte budget.`);
}

console.log(`AiCreateStudio chunk budget passed: ${bytes}/${maxBytes} bytes.`);

const assets = fs.readdirSync(assetsDir).filter(name => name.endsWith('.js'));
const views = assets.filter(name => /^studio-workbench-views-[\w-]+\.js$/.test(name));
if (views.length !== 1) throw Error(`Expected one Studio views chunk, found ${views.length}.`);
const chain = studioEntryImportPath({ chunks: assets, from: views[0], entry: chunks[0],
  readSource: name => fs.readFileSync(path.join(assetsDir, name), 'utf8') });
if (chain) throw Error(`Studio views import their page entry: ${chain.join(' -> ')}`);
console.log('Studio view chunk import boundary passed.');
