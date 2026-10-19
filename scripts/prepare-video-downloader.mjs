import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit maintenance command only. Never invoked by HTTP startup or a task.
// Official install guidance: https://github.com/yt-dlp/yt-dlp/wiki/Installation
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, '.venv-video-downloader');
const python = path.join(directory, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python3');
const requirements = path.join(root, 'scripts/video-downloader-requirements.txt');
if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw Error('video_downloader_venv_must_not_be_symlink');
function run(executable, args) {
  const result = spawnSync(executable, args, { stdio: 'inherit', cwd: root });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`video_downloader_setup_failed:${result.status}`);
}
if (!existsSync(python)) {
  if (existsSync(directory)) throw Error('video_downloader_existing_directory_incomplete: preserve it for inspection');
  const bundled = path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
  const explicit = process.argv.indexOf('--python');
  const base = explicit >= 0 ? process.argv[explicit + 1] : existsSync(bundled) ? bundled : 'python3';
  if (!base || (explicit >= 0 && !path.isAbsolute(base))) throw Error('video_downloader_absolute_python_path_required');
  run(base, ['-c', 'import sys; assert sys.version_info >= (3, 10), "yt-dlp requires Python >=3.10"']);
  run(base, ['-m', 'venv', directory]);
}
const config = readFileSync(path.join(directory, 'pyvenv.cfg'), 'utf8');
if (!/^include-system-site-packages\s*=\s*false\s*$/mi.test(config)) throw Error('video_downloader_venv_not_isolated');
run(python, ['-m', 'pip', '--isolated', '--disable-pip-version-check', 'install', '--index-url', 'https://pypi.org/simple', '--only-binary', ':all:', '--no-deps', '--require-hashes', '-r', requirements]);
run(python, ['-c', 'import os, sys, yt_dlp, yt_dlp.version; root=os.path.realpath(sys.argv[1]); assert os.path.realpath(sys.prefix)==root; assert os.path.realpath(yt_dlp.__file__).startswith(root+os.sep); assert yt_dlp.version.__version__=="2026.08.19"; print("Isolated downloader ready:", sys.executable, yt_dlp.version.__version__)', directory]);
console.log('Prepared project-local downloader only. No media request, provider call, cookies, task retry, authorization change or server reload was performed.');
