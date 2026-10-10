import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ExternalPreflightState = 'ready' | 'blocked';

export interface ExternalPreflightCheck {
  state: ExternalPreflightState;
  code: string;
  detail: string;
}

export interface ContentExternalPreflightReport {
  ready: boolean;
  checks: {
    objectStorage: ExternalPreflightCheck;
    seedanceSentence: ExternalPreflightCheck;
    avatarSourceCaptions: ExternalPreflightCheck;
  };
}

type Env = Record<string, string | undefined>;

const value = (env: Env, ...names: string[]) => names
  .map(name => String(env[name] || '').trim())
  .find(Boolean) || '';

const enabled = (env: Env, name: string) => value(env, name).toLowerCase() === 'true';

function dashscopeKeyConfigured(env: Env): boolean {
  if (value(env, 'DASHSCOPE_API_KEY')) return true;
  const file = value(env, 'DASHSCOPE_API_KEY_FILE')
    || (env === process.env ? path.join(os.homedir(), '.config/lingshu/dashscope.key') : '');
  try {
    if (!file) return false;
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size > 0 && stat.size <= 16_384 && Boolean(fs.readFileSync(file, 'utf8').trim());
  }
  catch { return false; }
}

function safeFailure(error: unknown): string {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  const status = candidate?.$metadata?.httpStatusCode;
  if (status) return `provider_http_${status}`;
  const name = String(candidate?.name || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return name ? `provider_error_${name}` : 'provider_request_failed';
}

export function objectStorageConfig(env: Env = process.env) {
  const accountId = value(env, 'R2_ACCOUNT_ID');
  const cosRegion = value(env, 'COS_REGION');
  const configuredDriver = value(env, 'OBJECT_STORAGE_DRIVER').toLowerCase();
  const driver = configuredDriver || (value(env, 'NODE_ENV').toLowerCase() === 'production' ? 'cos' : 'local');
  return {
    driver,
    endpoint: value(env, 'OBJECT_STORAGE_ENDPOINT', 'COS_ENDPOINT') || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '') || (cosRegion ? `https://cos.${cosRegion}.myqcloud.com` : ''),
    region: value(env, 'OBJECT_STORAGE_REGION', 'COS_REGION') || 'auto',
    accessKeyId: value(env, 'OBJECT_STORAGE_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID', 'COS_SECRET_ID'),
    secretAccessKey: value(env, 'OBJECT_STORAGE_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY', 'COS_SECRET_KEY'),
    bucket: value(env, 'OBJECT_STORAGE_BUCKET_NAME', 'R2_BUCKET_NAME', 'COS_BUCKET'),
  };
}

export function staticContentExternalPreflight(env: Env = process.env): ContentExternalPreflightReport {
  const storage = objectStorageConfig(env);
  const invalidStorageDriver = storage.driver !== 'local' && storage.driver !== 'cos';
  const storageMissing = storage.driver === 'local' ? [] : [
    !storage.endpoint && 'endpoint_or_account',
    !storage.accessKeyId && 'access_key_id',
    !storage.secretAccessKey && 'secret_access_key',
    !storage.bucket && 'bucket',
  ].filter(Boolean);
  const seedanceMissing = [
    !enabled(env, 'SEEDANCE_SENTENCE_ENABLED') && 'SEEDANCE_SENTENCE_ENABLED=true',
    !value(env, 'SEEDANCE_API_KEY') && 'SEEDANCE_API_KEY',
    !value(env, 'SEEDANCE_MODEL') && 'SEEDANCE_MODEL',
    !(value(env, 'SEEDREAM_API_KEY') || value(env, 'SEEDANCE_API_KEY')) && 'SEEDREAM_API_KEY_or_SEEDANCE_API_KEY（Seedream 首帧生成）',
    enabled(env, 'DIGITAL_HUMAN_SEMANTIC_QA_ENABLED') && !(value(env, 'DASHSCOPE_API_KEY') || value(env, 'DASHSCOPE_API_KEY_FILE')) && 'DASHSCOPE_API_KEY_or_DASHSCOPE_API_KEY_FILE（独立语义质检）',
    enabled(env, 'DIGITAL_HUMAN_SEMANTIC_QA_ENABLED') && !value(env, 'QWEN_DIGITAL_HUMAN_QA_MODEL') && 'QWEN_DIGITAL_HUMAN_QA_MODEL',
    storage.driver === 'local' && !/^https:\/\//i.test(value(env, 'LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL'))
      && 'LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL（公网 HTTPS）',
  ].filter(Boolean);
  const avatarCaptionMissing = [
    !dashscopeKeyConfigured(env) && 'DASHSCOPE_API_KEY_or_DASHSCOPE_API_KEY_FILE',
    storage.driver === 'local' && !/^https:\/\//i.test(value(env, 'LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL'))
      && 'LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL（公网 HTTPS）',
    storage.driver !== 'local' && (invalidStorageDriver || storageMissing.length > 0) && 'object_storage',
  ].filter(Boolean);
  const checks = {
    objectStorage: invalidStorageDriver
      ? { state: 'blocked' as const, code: 'object_storage_driver_invalid', detail: 'OBJECT_STORAGE_DRIVER must be local or cos' }
      : storageMissing.length
      ? { state: 'blocked' as const, code: 'object_storage_config_missing', detail: `missing:${storageMissing.join(',')}` }
      : storage.driver === 'local'
        ? { state: 'ready' as const, code: 'local_object_storage_configured', detail: 'local filesystem storage selected; external suppliers still require HTTPS or trusted asset inputs' }
        : { state: 'ready' as const, code: 'object_storage_configured', detail: 'required settings are present' },
    seedanceSentence: seedanceMissing.length
      ? { state: 'blocked' as const, code: 'seedance_sentence_config_missing', detail: `missing:${seedanceMissing.join(',')}` }
      : { state: 'ready' as const, code: 'seedance_sentence_configured', detail: 'required settings are present' },
    avatarSourceCaptions: avatarCaptionMissing.length
      ? { state: 'blocked' as const, code: 'avatar_source_captions_config_missing', detail: `missing:${avatarCaptionMissing.join(',')}` }
      : { state: 'ready' as const, code: 'avatar_source_captions_configured', detail: 'source-audio alignment requirements are present' },
  };
  return { ready: Object.values(checks).every(check => check.state === 'ready'), checks };
}

export async function contentExternalConnectivityPreflight(input: {
  env?: Env;
  headBucket?: (config: ReturnType<typeof objectStorageConfig>) => Promise<void>;
  listSeedanceModels?: (config: { baseUrl: string; apiKey: string }) => Promise<string[]>;
} = {}): Promise<ContentExternalPreflightReport> {
  const env = input.env || process.env;
  const report = staticContentExternalPreflight(env);
  if (report.checks.objectStorage.state === 'ready') {
    const config = objectStorageConfig(env);
    if (config.driver === 'local') {
      report.checks.objectStorage = { state: 'ready', code: 'local_object_storage_available', detail: 'local filesystem storage selected; no cloud request was made' };
    } else try {
      if (input.headBucket) await input.headBucket(config);
      else {
        const client = new S3Client({
          region: config.region,
          endpoint: config.endpoint,
          credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        });
        await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      }
      report.checks.objectStorage = { state: 'ready', code: 'object_storage_reachable', detail: 'bucket HEAD succeeded' };
    } catch (error) {
      report.checks.objectStorage = { state: 'blocked', code: 'object_storage_unreachable', detail: safeFailure(error) };
    }
  }
  if (report.checks.seedanceSentence.state === 'ready') {
    const apiKey = value(env, 'SEEDANCE_API_KEY');
    const model = value(env, 'SEEDANCE_MODEL');
    const baseUrl = (value(env, 'SEEDANCE_BASE_URL') || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
    try {
      let models: string[];
      if (input.listSeedanceModels) models = await input.listSeedanceModels({ baseUrl, apiKey });
      else {
        const response = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          const error = new Error('provider request failed') as Error & { $metadata?: { httpStatusCode: number } };
          error.$metadata = { httpStatusCode: response.status };
          throw error;
        }
        const payload = await response.json() as { data?: Array<{ id?: unknown }> };
        models = Array.isArray(payload.data) ? payload.data.map(item => String(item.id || '')).filter(Boolean) : [];
      }
      if (!models.includes(model)) {
        const error = new Error('configured model was not listed');
        error.name = 'ConfiguredModelNotListed';
        throw error;
      }
      report.checks.seedanceSentence = { state: 'ready', code: 'seedance_model_reachable', detail: 'credential accepted and configured model is listed' };
    } catch (error) {
      report.checks.seedanceSentence = { state: 'blocked', code: 'seedance_model_unreachable', detail: safeFailure(error) };
    }
  }
  report.ready = Object.values(report.checks).every(check => check.state === 'ready');
  return report;
}
