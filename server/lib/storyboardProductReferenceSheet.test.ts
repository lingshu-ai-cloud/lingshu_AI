import assert from 'node:assert/strict';
import sharp from 'sharp';
import { storyboardMultiProductViewSheet, storyboardProductReferenceSheet } from './storyboardProductReferenceSheet.js';

const red = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#ff0000' } }).png().toBuffer();
const blue = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#0000ff' } }).png().toBuffer();
const sheet = await storyboardProductReferenceSheet([
  { mimeType: 'image/png', base64: red.toString('base64') },
  { mimeType: 'image/png', base64: blue.toString('base64') },
]);
assert.equal(sheet.mimeType, 'image/png');
const bytes = Buffer.from(sheet.base64, 'base64');
const metadata = await sharp(bytes).metadata();
assert.equal(metadata.width, 1440);
assert.equal(metadata.height, 1152);
const left = await sharp(bytes).extract({ left: 360, top: 576, width: 1, height: 1 }).raw().toBuffer();
const right = await sharp(bytes).extract({ left: 1080, top: 576, width: 1, height: 1 }).raw().toBuffer();
assert.ok(left[0] > 200 && left[2] < 50, 'first product remains in left cell');
assert.ok(right[2] > 200 && right[0] < 50, 'second product remains in right cell');
const grid = await storyboardMultiProductViewSheet([
  [{ mimeType: 'image/png', base64: red.toString('base64') }, { mimeType: 'image/png', base64: blue.toString('base64') }],
  [{ mimeType: 'image/png', base64: blue.toString('base64') }],
]);
const gridBytes = Buffer.from(grid.base64, 'base64');
assert.equal((await sharp(gridBytes).metadata()).height, 1536);
const bottomLeft = await sharp(gridBytes).extract({ left: 360, top: 1152, width: 1, height: 1 }).raw().toBuffer();
const topRight = await sharp(gridBytes).extract({ left: 1080, top: 384, width: 1, height: 1 }).raw().toBuffer();
assert.ok(bottomLeft[2] > 200 && bottomLeft[0] < 50, 'second view stays below its product');
assert.ok(topRight[2] > 200 && topRight[0] < 50, 'other product stays in its own column');
console.log('storyboardProductReferenceSheet tests passed');
