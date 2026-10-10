import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'dotenv';

export const PROVIDER_ENV_SELECTOR = 'LINGSHU_PREVIEW_PROVIDER_ENV_FILE';

// Deliberately exact: never inherit database/storage/auth/publishing/worker or
// VITE settings from another checkout. Budget ceilings travel with providers;
// absent ceilings are not manufactured here and still need explicit setup.
export const PREVIEW_PROVIDER_ENV_KEYS = Object.freeze([
  'OVERSEAS_LLM_BACKEND',
  'DASHSCOPE_API_KEY', 'DASHSCOPE_BASE_URL', 'DASHSCOPE_IMAGE_BASE_URL',
  'QWEN_TEXT_MODEL', 'QWEN_VL_MODEL', 'QWEN_EXACT_VL_MODEL', 'QWEN_MATERIAL_VL_MODEL',
  'QWEN_IMAGE_MODEL', 'QWEN_ASR_MODEL', 'QWEN_ASR_BASE_URL', 'QWEN_ASR_GENERATION_ENABLED',
  'QWEN_TTS_MODEL', 'QWEN_FIRST_FRAME_ESTIMATED_CNY',
  'GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_VIDEO_ENABLED',
  'MINIMAX_API_KEY', 'MINIMAX_BASE_URL', 'MINIMAX_GROUP_ID', 'MINIMAX_TTS_MODEL',
  'HEYGEN_API_KEY', 'HEYGEN_GENERATION_ENABLED', 'HEYGEN_PHOTO_ESTIMATED_CNY_PER_SECOND',
  'SEEDANCE_API_KEY', 'SEEDANCE_BASE_URL', 'SEEDANCE_MODEL', 'SEEDANCE_VIDEO_ENABLED',
  'SEEDANCE_SENTENCE_ENABLED', 'SEEDANCE_REFERENCE_ENABLED',
  'SEEDANCE_REFERENCE_ESTIMATED_CNY_PER_SECOND', 'SEEDANCE_CNY_PER_1K_TOKENS',
  'SEEDANCE_2_FAST_CNY_PER_MILLION', 'SEEDANCE_2_MINI_CNY_PER_MILLION', 'SEEDANCE_2_CNY_PER_MILLION',
  'SEEDANCE_ESTIMATED_CNY_PER_SECOND_480P', 'SEEDANCE_ESTIMATED_CNY_PER_SECOND_720P',
  'SEEDANCE_ESTIMATED_CNY_PER_SECOND_1080P', 'SEEDANCE_TENANT_MONTHLY_BUDGET_CNY',
  'SEEDREAM_API_KEY', 'SEEDREAM_BASE_URL', 'SEEDREAM_IMAGE_MODEL', 'SEEDREAM_FIRST_FRAME_ESTIMATED_CNY',
  'STUDIO_PAID_BUDGET_CNY', 'STUDIO_PAID_OPENING_USED_CNY',
  'STUDIO_HEYGEN_RESERVE_CNY', 'STUDIO_ASR_RESERVE_CNY',
  'DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT', 'DIGITAL_HUMAN_REFERENCE_MONTHLY_BUDGET_CNY',
  'STORYBOARD_AIGC_BATCH_BUDGET_CNY', 'STORYBOARD_AIGC_MAX_RETRIES',
  'STORYBOARD_AIGC_FIRST_FRAME_ESTIMATED_CNY', 'STORYBOARD_AIGC_CLONE_GEOMETRY_ESTIMATED_CNY',
]);

const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const maxEnvironmentBytes = 256 * 1024;
const fail = code => { throw new Error(`Local preview provider configuration rejected (${code}).`); };

function git(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root, encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    fail('git_identity_unavailable');
  }
}

function realDirectory(directory) {
  try { return fs.realpathSync(directory); } catch { fail('directory_unavailable'); }
}

function readEnvironment(file, allowedDirectory, optional = false) {
  try {
    // Resolve before opening: a symlink must not extend the read scope beyond
    // this checkout or the verified primary checkout, respectively.
    const resolved = fs.realpathSync(file);
    if (path.dirname(resolved) !== allowedDirectory
      || !['.env', '.env.local'].includes(path.basename(resolved))) fail('file_outside_checkout');
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > maxEnvironmentBytes) fail('invalid_environment_file');
    return parse(fs.readFileSync(resolved));
  } catch (error) {
    if (optional && error?.code === 'ENOENT') return {};
    // Never forward fs/dotenv errors, which can include paths or file content.
    fail('environment_file_unavailable_or_unsafe');
  }
}

/** Explicit, read-only local-preview opt-in. Never mutates process.env.
 * Returned providerEnv contains secrets: callers must log only loadedKeys.
 */
export function loadLocalPreviewProviderEnvironment({ runtimeRoot, env = process.env }) {
  const root = realDirectory(runtimeRoot);
  const local = readEnvironment(path.join(root, '.env.local'), root, true);
  // A startup empty selector explicitly disables file-based opt-in.
  const selector = owns(env, PROVIDER_ENV_SELECTOR) ? env[PROVIDER_ENV_SELECTOR] : local[PROVIDER_ENV_SELECTOR];
  if (typeof selector !== 'string' || !selector.trim()) return { providerEnv: {}, loadedKeys: [] };

  const current = readEnvironment(path.join(root, '.env'), root, true);
  if ([env.NODE_ENV, local.NODE_ENV, current.NODE_ENV].includes('production')) fail('production_not_allowed');
  if (realDirectory(git(root, ['rev-parse', '--show-toplevel'])) !== root) fail('runtime_must_be_checkout_root');
  const records = git(root, ['worktree', 'list', '--porcelain', '-z']).split('\0');
  const primaryRecord = records.find(record => record.startsWith('worktree '));
  if (!primaryRecord) fail('primary_checkout_unavailable');
  const primary = realDirectory(primaryRecord.slice('worktree '.length));
  const commonDirectory = checkout => realDirectory(path.resolve(checkout, git(checkout, ['rev-parse', '--git-common-dir'])));
  if (commonDirectory(root) !== commonDirectory(primary)) fail('unrelated_repository');

  const sourceFile = path.resolve(root, selector.trim());
  if (realDirectory(path.dirname(sourceFile)) !== primary || !['.env', '.env.local'].includes(path.basename(sourceFile))) {
    fail('source_must_be_primary_environment');
  }
  const source = readEnvironment(sourceFile, primary);
  const providerEnv = {};
  for (const key of PREVIEW_PROVIDER_ENV_KEYS) {
    // Presence, not truthiness: an explicit false/empty disables inheritance.
    if (owns(env, key) || owns(local, key) || owns(current, key)) continue;
    if (owns(source, key) && source[key].trim()) providerEnv[key] = source[key];
  }
  return { providerEnv, loadedKeys: Object.keys(providerEnv) };
}

export function providerEnvironmentForService(serviceName, configuration) {
  return serviceName === 'backend' ? { ...configuration.providerEnv } : {};
}
