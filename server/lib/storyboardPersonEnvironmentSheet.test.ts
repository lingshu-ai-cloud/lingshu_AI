import assert from 'node:assert/strict';
import sharp from 'sharp';
import { storyboardPersonEnvironmentSheet } from './storyboardPersonEnvironmentSheet.js';

const red = await sharp({ create: { width: 500, height: 900, channels: 3, background: '#ff0000' } }).png().toBuffer();
const blue = await sharp({ create: { width: 900, height: 500, channels: 3, background: '#0000ff' } }).png().toBuffer();
const sheet = await storyboardPersonEnvironmentSheet(
  { mimeType: 'image/png', base64: red.toString('base64') },
  { mimeType: 'image/png', base64: blue.toString('base64') },
);
const bytes = Buffer.from(sheet.base64, 'base64');
const metadata = await sharp(bytes).metadata();
assert.deepEqual([metadata.width, metadata.height], [1920, 1152]);
const person = await sharp(bytes).extract({ left: 384, top: 576, width: 1, height: 1 }).raw().toBuffer();
const environment = await sharp(bytes).extract({ left: 1344, top: 576, width: 1, height: 1 }).raw().toBuffer();
assert.ok(person[0] > 200 && person[2] < 50);
assert.ok(environment[2] > 200 && environment[0] < 50);
console.log('storyboardPersonEnvironmentSheet tests passed');
