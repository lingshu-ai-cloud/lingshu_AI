import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const SHEETJS = Object.freeze({
  file: new URL('../vendor/xlsx-0.20.3.tgz', import.meta.url),
  source: 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz',
  sha256: '8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8',
  packageName: 'xlsx',
  version: '0.20.3',
  licenseEntry: 'package/LICENSE',
});

function tarEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const rawSize = header.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim();
    const size = rawSize ? Number.parseInt(rawSize, 8) : 0;
    if (!name || !Number.isSafeInteger(size) || size < 0) throw new Error('Vendored SheetJS tarball has an invalid TAR header');
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > buffer.length) throw new Error('Vendored SheetJS tarball is truncated');
    entries.set(name, buffer.subarray(bodyStart, bodyEnd));
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

const tarball = readFileSync(SHEETJS.file);
const actualSha256 = createHash('sha256').update(tarball).digest('hex');
if (actualSha256 !== SHEETJS.sha256) {
  throw new Error(`Vendored SheetJS checksum mismatch: expected ${SHEETJS.sha256}, received ${actualSha256}`);
}

const entries = tarEntries(gunzipSync(tarball));
const packageJsonBytes = entries.get('package/package.json');
if (!packageJsonBytes) throw new Error('Vendored SheetJS package.json is missing');
const packageJson = JSON.parse(packageJsonBytes.toString('utf8'));
if (packageJson.name !== SHEETJS.packageName || packageJson.version !== SHEETJS.version) {
  throw new Error(`Vendored SheetJS identity mismatch: expected ${SHEETJS.packageName}@${SHEETJS.version}`);
}
if (!entries.has(SHEETJS.licenseEntry)) throw new Error('Vendored SheetJS LICENSE is missing');

console.log(`Vendored SheetJS verified: ${SHEETJS.packageName}@${SHEETJS.version}`);
console.log(`Source: ${SHEETJS.source}`);
console.log(`SHA-256: ${SHEETJS.sha256}`);
