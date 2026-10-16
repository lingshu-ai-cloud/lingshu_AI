import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVideoDownloaderPythonResolver } from './videoDownloaderPython.js';

test('verified explicit interpreter wins; project-local environment precedes bundled/system without shell or downloads', () => {
  const seen: string[] = [];
  const resolve = createVideoDownloaderPythonResolver({ env: { YT_DLP_PYTHON: '/explicit/python' }, root: '/project', home: '/home/operator', platform: 'darwin', exists: () => true, check: python => { seen.push(python);return true; } });
  assert.equal(resolve(), '/explicit/python');assert.equal(resolve(), '/explicit/python');assert.deepEqual(seen, ['/explicit/python']);
  const local = createVideoDownloaderPythonResolver({ env: {}, root: '/project', home: '/home/operator', platform: 'linux', exists: () => true, check: python => python === '/project/.venv-video-downloader/bin/python3' });
  assert.equal(local(), '/project/.venv-video-downloader/bin/python3');
});
test('missing project interpreter falls back only after an actual import check; failures are not cached', () => {
  const seen: string[] = [];let ready = false;
  const resolve = createVideoDownloaderPythonResolver({ env: { PYTHON: '/existing/python' }, root: '/project', home: '/home/operator', platform: 'linux', exists: () => false, check: python => { seen.push(python);return ready && python === '/existing/python'; } });
  assert.throws(resolve,/video_downloader_not_installed/);ready=true;
  assert.equal(resolve(),'/existing/python');assert.deepEqual(seen,['/existing/python','python3','/existing/python']);
});
test('preparation is a pinned hash-verified project-only explicit install, never media/cookies or system packages', () => {
  const requirements = readFileSync(new URL('../../scripts/video-downloader-requirements.txt',import.meta.url),'utf8');
  const script = readFileSync(new URL('../../scripts/prepare-video-downloader.mjs',import.meta.url),'utf8');
  assert.match(requirements,/yt-dlp==2026\.8\.19 --hash=sha256:[a-f0-9]{64}/);
  assert.match(script,/'--index-url', 'https:\/\/pypi\.org\/simple'/);
  assert.match(script,/'--require-hashes'/);assert.match(script,/'--only-binary', ':all:'/);assert.match(script,/'-m', 'venv', directory/);
  assert.doesNotMatch(script,/--system-site-packages|--break-system-packages|--cookies|cookies-from-browser|execSync|shell:\s*true/);
});
