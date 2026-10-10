import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  socialContentRenderTempRoot,
  withSocialContentRenderWorkspace,
} from './socialContentRenderWorkspace.js';

assert.equal(path.resolve(socialContentRenderTempRoot()), path.resolve(os.tmpdir()));

let successfulDirectory = '';
const value = await withSocialContentRenderWorkspace(async directory => {
  successfulDirectory = directory;
  assert.equal(path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`), true);
  await fsp.writeFile(path.join(directory, 'render.mp4'), Buffer.from('temporary render'));
  return 'uploaded';
});
assert.equal(value, 'uploaded');
await assert.rejects(() => fsp.stat(successfulDirectory), { code: 'ENOENT' });

let failedDirectory = '';
await assert.rejects(
  () => withSocialContentRenderWorkspace(async directory => {
    failedDirectory = directory;
    await fsp.writeFile(path.join(directory, 'partial.mp4'), Buffer.from('partial render'));
    throw new Error('render failed');
  }),
  /render failed/,
);
await assert.rejects(() => fsp.stat(failedDirectory), { code: 'ENOENT' });

console.log('social content render workspace tests passed');
