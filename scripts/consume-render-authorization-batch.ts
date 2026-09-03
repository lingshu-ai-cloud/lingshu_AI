/**
 * Consume one previously issued exactly-three render authorization receipt.
 *
 * This command is deliberately separate from authorization. It validates the
 * complete external receipt before the first /render/local request and never
 * writes or prints the short-lived render tokens.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  REQUIRED_LANGUAGES,
  type Language,
} from './orchestrate-digital-human-p1.js';

type JsonRecord = Record<string, unknown>;

export interface RenderBatchReceiptAuthorization {
  language: Language;
  token: string;
  expiresAt: string;
  manifest: {
    jobId: string;
    sourceProjectId: string;
    spec: { language: Language; [key: string]: unknown };
    [key: string]: unknown;
  };
}

export interface ParsedRenderBatchReceipt {
  batchKey: string;
  batchFingerprint: string;
  sourceProjectId: string;
  authorizations: RenderBatchReceiptAuthorization[];
}

export interface ConsumerCliOptions {
  baseUrl: string;
  authorizationFile: string;
  outputFile: string;
  apply: boolean;
  allowRemote: boolean;
  confirmRenderExecution: boolean;
}

class RenderConsumerClient {
  private accessToken = '';

  constructor(private readonly baseUrl: string, private readonly env: NodeJS.ProcessEnv = process.env) {}

  async authenticate(): Promise<void> {
    if (this.env.LINGSHU_TOKEN?.trim()) {
      this.accessToken = this.env.LINGSHU_TOKEN.trim();
      return;
    }
    const email = this.env.LINGSHU_EMAIL?.trim();
    const password = this.env.LINGSHU_PASSWORD;
    if (!email || !password) throw new Error('Set LINGSHU_TOKEN, or both LINGSHU_EMAIL and LINGSHU_PASSWORD');
    const response = await fetch(new URL('/api/overseas/auth/login', this.baseUrl), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    const payload = await response.json().catch(() => ({})) as JsonRecord;
    if (!response.ok || typeof payload.token !== 'string' || !payload.token) throw new Error('Login failed or did not return a token');
    this.accessToken = payload.token;
  }

  async render(jobId: string, renderToken: string): Promise<JsonRecord> {
    if (!jobId || !renderToken) throw new Error('render request is missing a job id or token');
    const response = await fetch(new URL('/api/overseas/studio/render/local', this.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        'X-Render-Token': renderToken,
      },
      body: JSON.stringify({ jobId }),
    });
    const payload = await response.json().catch(() => ({})) as JsonRecord;
    if (!response.ok) {
      const message = typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`;
      const code = typeof payload.code === 'string' ? ` (${payload.code})` : '';
      throw new Error(`${message}${code}`);
    }
    return payload;
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function outsideRepository(filename: string, mustExist: boolean): string {
  const resolved = path.resolve(filename);
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const relative = path.relative(repositoryRoot, resolved);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('Receipt paths must be outside the repository');
  }
  if (mustExist && (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile())) {
    throw new Error(`Authorization receipt does not exist: ${resolved}`);
  }
  if (!mustExist && fs.existsSync(resolved)) throw new Error(`Result receipt already exists: ${resolved}`);
  const parent = path.dirname(resolved);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new Error(`Receipt parent directory does not exist: ${parent}`);
  return resolved;
}

function isLoopback(raw: string): boolean {
  const parsed = new URL(raw);
  return parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
}

export function parseConsumerCli(argv: string[], env: NodeJS.ProcessEnv = process.env): ConsumerCliOptions {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const [rawKey, inline] = token.slice(2).split('=', 2);
    const key = String(rawKey || '');
    if (['apply', 'allow-remote', 'confirm-render-execution'].includes(key)) {
      if (inline !== undefined) throw new Error(`--${key} does not accept a value`);
      switches.add(key);
      continue;
    }
    if (!['base-url', 'authorization', 'output'].includes(key)) throw new Error(`Unknown option: --${key}`);
    const value = inline ?? argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value`);
    values.set(key, value);
  }
  const baseUrl = String(values.get('base-url') || env.LINGSHU_BASE_URL || 'http://127.0.0.1:8788').replace(/\/+$/, '');
  const parsedBase = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsedBase.protocol) || parsedBase.username || parsedBase.password
    || parsedBase.pathname !== '/' || parsedBase.search || parsedBase.hash) {
    throw new Error('--base-url must be an HTTP(S) origin without credentials, path, query, or hash');
  }
  const authorizationFile = values.get('authorization');
  const outputFile = values.get('output');
  if (!authorizationFile || !outputFile) throw new Error('--authorization and --output are required');
  const options = {
    baseUrl,
    authorizationFile: outsideRepository(authorizationFile, true),
    outputFile: outsideRepository(outputFile, false),
    apply: switches.has('apply'),
    allowRemote: switches.has('allow-remote'),
    confirmRenderExecution: switches.has('confirm-render-execution'),
  };
  if (!isLoopback(baseUrl) && !options.allowRemote) throw new Error('Remote base URL refused; add --allow-remote only after verifying the target tenant');
  if (!options.apply || !options.confirmRenderExecution) {
    throw new Error('Rendering requires both --apply and --confirm-render-execution');
  }
  return options;
}

export function parseRenderBatchReceipt(text: string, nowMs = Date.now()): ParsedRenderBatchReceipt {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) as unknown; }
    catch { throw new Error(`Authorization receipt line ${index + 1} is not valid JSON`); }
  });
  const records = lines.map(record);
  if (records.some(item => item.type === 'failure')) throw new Error('Authorization receipt contains a failed batch');
  const batches = records.filter(item => item.type === 'batch');
  const rows = records.filter(item => item.type === 'authorization');
  if (batches.length !== 1 || rows.length !== 3) throw new Error('Authorization receipt must contain one batch and exactly three authorizations');
  if (records.some(item => !['header', 'batch', 'authorization'].includes(String(item.type || '')))) {
    throw new Error('Authorization receipt contains an unsupported record type');
  }
  const batch = batches[0]!;
  const batchKey = String(batch.batchKey || '').trim();
  const batchFingerprint = String(batch.batchFingerprint || '').trim().toLowerCase();
  const sourceProjectId = String(batch.sourceProjectId || '').trim();
  if (!batchKey || !/^[a-f0-9]{64}$/.test(batchFingerprint) || !sourceProjectId) {
    throw new Error('Authorization batch identity is incomplete');
  }
  const byLanguage = new Map<Language, RenderBatchReceiptAuthorization>();
  const jobIds = new Set<string>();
  for (const row of rows) {
    const language = String(row.language || '') as Language;
    if (!REQUIRED_LANGUAGES.includes(language) || byLanguage.has(language)) throw new Error('Authorization languages must be unique zh, en, es');
    const response = record(row.response);
    const manifest = record(response.manifest);
    const spec = record(manifest.spec);
    const jobId = String(manifest.jobId || '').trim();
    const projectId = String(manifest.sourceProjectId || '').trim();
    const token = String(response.token || '').trim();
    const expiresAt = String(response.expiresAt || '').trim();
    const expiresAtMs = Date.parse(expiresAt);
    if (!jobId || jobIds.has(jobId) || !token || !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
      throw new Error(`${language} render authorization is missing, duplicated, or expired`);
    }
    if (projectId !== sourceProjectId || String(spec.language || '') !== language) {
      throw new Error(`${language} render authorization project/language binding is invalid`);
    }
    jobIds.add(jobId);
    byLanguage.set(language, {
      language,
      token,
      expiresAt,
      manifest: { ...manifest, jobId, sourceProjectId: projectId, spec: { ...spec, language } } as RenderBatchReceiptAuthorization['manifest'],
    });
  }
  if (REQUIRED_LANGUAGES.some(language => !byLanguage.has(language))) throw new Error('Authorization languages must be exactly zh, en, es');
  return { batchKey, batchFingerprint, sourceProjectId, authorizations: REQUIRED_LANGUAGES.map(language => byLanguage.get(language)!) };
}

export async function consumeRenderBatch(options: ConsumerCliOptions): Promise<string> {
  const receipt = parseRenderBatchReceipt(fs.readFileSync(options.authorizationFile, 'utf8'));
  const api = new RenderConsumerClient(options.baseUrl);
  await api.authenticate();
  const descriptor = fs.openSync(options.outputFile, 'wx', 0o600);
  const failures: string[] = [];
  try {
    fs.writeSync(descriptor, `${JSON.stringify({
      type: 'header',
      schemaVersion: 'render-batch-result-v1',
      createdAt: new Date().toISOString(),
      batchKey: receipt.batchKey,
      batchFingerprint: receipt.batchFingerprint,
      sourceProjectId: receipt.sourceProjectId,
    })}\n`, undefined, 'utf8');
    fs.fsyncSync(descriptor);
    for (const authorization of receipt.authorizations) {
      try {
        if (Date.parse(authorization.expiresAt) <= Date.now() + 10_000) {
          throw new Error('render authorization expired before this sequential render could start; reauthorize the same batch key');
        }
        const response = await api.render(authorization.manifest.jobId, authorization.token);
        fs.writeSync(descriptor, `${JSON.stringify({
          type: 'result', language: authorization.language, jobId: authorization.manifest.jobId, response,
        })}\n`, undefined, 'utf8');
        process.stdout.write(`[render] ${authorization.language}: completed\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'render request failed';
        failures.push(`${authorization.language}: ${message}`);
        fs.writeSync(descriptor, `${JSON.stringify({
          type: 'failure', language: authorization.language, jobId: authorization.manifest.jobId, message,
        })}\n`, undefined, 'utf8');
        process.stderr.write(`[render] ${authorization.language}: failed\n`);
      }
      fs.fsyncSync(descriptor);
    }
  } finally {
    fs.closeSync(descriptor);
  }
  if (failures.length) throw new Error(`Render batch finished with ${failures.length} failure(s); inspect the external result receipt`);
  return options.outputFile;
}

const HELP = `Consume an external exactly-three render authorization receipt.

tsx scripts/consume-render-authorization-batch.ts \\
  --authorization D:\\secure\\render-authorizations.jsonl \\
  --output D:\\secure\\render-results.jsonl \\
  --apply --confirm-render-execution

Credentials come from LINGSHU_TOKEN or LINGSHU_EMAIL/LINGSHU_PASSWORD. Tokens
remain only in the input receipt and are never printed or copied to results.
`;

const invokedDirectly = Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1]!)).href === import.meta.url;
if (invokedDirectly) {
  if (process.argv.slice(2).includes('--help')) process.stdout.write(HELP);
  else consumeRenderBatch(parseConsumerCli(process.argv.slice(2))).then(output => {
    process.stdout.write(`[render] three-language result receipt: ${output}\n`);
  }).catch(error => {
    process.stderr.write(`[render-batch] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
