#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

export const DEFAULT_READ_ONLY_PATHS = Object.freeze([
  '/api/overseas/health',
  '/api/overseas/ready',
]);

export const CAPACITY_PROFILES = Object.freeze({
  'safe-smoke-v1': Object.freeze({
    concurrency: 10,
    durationSeconds: 10,
    warmupSeconds: 1,
    timeoutMs: 5_000,
    minSuccessfulRps: 5,
    maxErrorRate: 0.01,
    maxP95Ms: 500,
    maxP99Ms: 1_500,
    maxResponseBytes: 1_048_576,
  }),
  'public-read-1000-v1': Object.freeze({
    concurrency: 1_000,
    durationSeconds: 1_800,
    warmupSeconds: 60,
    timeoutMs: 5_000,
    minSuccessfulRps: 60,
    maxErrorRate: 0.01,
    maxP95Ms: 500,
    maxP99Ms: 1_500,
    maxResponseBytes: 1_048_576,
  }),
});

const MUTATING_PATH_SEGMENT = /(?:^|\/)(?:generate|generation|render|publish|send|execute|launch|approve|reject|retry|create|update|delete|upload|import|sync|migrate|checkout|payment|pay|purchase|subscribe|webhook|callback|run|start|stop|pause|resume|cancel)(?:\/|$)/i;
const MUTATING_QUERY_KEY = /^(?:action|command|operation|mutation|execute|publish|generate|send|delete|update|create)$/i;
const SENSITIVE_QUERY_KEY = /(?:token|secret|password|authorization|signature|api_?key)/i;
const MAX_TOKEN_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOKEN_COUNT = 100_000;

export class CapacityConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CapacityConfigurationError';
  }
}

function optionParts(argument) {
  const equals = argument.indexOf('=');
  return equals < 0 ? [argument, undefined] : [argument.slice(0, equals), argument.slice(equals + 1)];
}

function optionValue(args, index, inline, name) {
  const value = inline ?? args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new CapacityConfigurationError(`${name} requires a value`);
  return [value, inline === undefined ? index + 1 : index];
}

function finiteNumber(value, name, minimum, maximum, integer = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum || (integer && !Number.isInteger(parsed))) {
    throw new CapacityConfigurationError(`${name} must be ${integer ? 'an integer' : 'a number'} between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function errorRate(value) {
  const text = String(value).trim();
  const parsed = text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new CapacityConfigurationError('--max-error-rate must be a fraction from 0 to 1, or a percentage such as 1%');
  }
  return parsed;
}

function selectedProfile(args) {
  let profile = 'safe-smoke-v1';
  for (let index = 0; index < args.length; index += 1) {
    const [name, inline] = optionParts(args[index]);
    if (name !== '--profile') continue;
    const [value, consumed] = optionValue(args, index, inline, '--profile');
    profile = value;
    index = consumed;
  }
  if (!(profile in CAPACITY_PROFILES)) {
    throw new CapacityConfigurationError(`unknown profile ${profile}; expected one of ${Object.keys(CAPACITY_PROFILES).join(', ')}`);
  }
  return profile;
}

function validateBaseUrl(raw, carriesBearerTokens) {
  let url;
  try { url = new URL(raw); } catch { throw new CapacityConfigurationError('--base-url must be an absolute HTTP(S) URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new CapacityConfigurationError('--base-url must use http or https');
  if (url.username || url.password) throw new CapacityConfigurationError('--base-url must not contain credentials');
  if (url.search || url.hash) throw new CapacityConfigurationError('--base-url must not contain a query or fragment');
  if (url.pathname !== '/' && url.pathname !== '') throw new CapacityConfigurationError('--base-url must be an origin without a path');
  const loopback = url.hostname === 'localhost' || url.hostname === '::1' || url.hostname === '[::1]' || /^127\./.test(url.hostname);
  if (carriesBearerTokens && url.protocol !== 'https:' && !loopback) {
    throw new CapacityConfigurationError('bearer tokens may only be sent to HTTPS targets or loopback HTTP');
  }
  return url.origin;
}

export function validateReadOnlyPaths(paths, { custom = false, confirmed = false } = {}) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 32) {
    throw new CapacityConfigurationError('between 1 and 32 read-only paths are required');
  }
  if (custom && !confirmed) {
    throw new CapacityConfigurationError('custom paths require --confirm-read-only after verifying every handler is side-effect free');
  }
  const normalized = paths.map(raw => {
    if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) {
      throw new CapacityConfigurationError(`read-only path must be relative and start with /: ${String(raw)}`);
    }
    const url = new URL(raw, 'http://capacity.invalid');
    if (url.origin !== 'http://capacity.invalid' || url.hash) throw new CapacityConfigurationError(`invalid read-only path: ${raw}`);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { throw new CapacityConfigurationError(`path contains invalid encoding: ${raw}`); }
    if (!pathname.startsWith('/api/')) throw new CapacityConfigurationError(`only /api/ paths are allowed: ${raw}`);
    if (pathname.includes('..')) throw new CapacityConfigurationError(`path traversal is not allowed: ${raw}`);
    if (MUTATING_PATH_SEGMENT.test(pathname)) {
      throw new CapacityConfigurationError(`path contains a mutation-like action and is blocked: ${raw}`);
    }
    for (const key of url.searchParams.keys()) {
      if (MUTATING_QUERY_KEY.test(key)) throw new CapacityConfigurationError(`query parameter ${key} is mutation-like and is blocked`);
      if (SENSITIVE_QUERY_KEY.test(key)) throw new CapacityConfigurationError(`sensitive query parameter ${key} is blocked; use the bearer-token file`);
    }
    return `${url.pathname}${url.search}`;
  });
  if (new Set(normalized).size !== normalized.length) throw new CapacityConfigurationError('duplicate read-only paths are not allowed');
  return normalized;
}

export function parseCapacityArgs(args) {
  if (args.includes('--help') || args.includes('-h')) return { help: true };
  const profileName = selectedProfile(args);
  const profile = CAPACITY_PROFILES[profileName];
  const config = {
    profile: profileName,
    baseUrl: 'http://127.0.0.1:8788',
    paths: [...DEFAULT_READ_ONLY_PATHS],
    concurrency: profile.concurrency,
    durationSeconds: profile.durationSeconds,
    warmupSeconds: profile.warmupSeconds,
    timeoutMs: profile.timeoutMs,
    minSuccessfulRps: profile.minSuccessfulRps,
    maxErrorRate: profile.maxErrorRate,
    maxP95Ms: profile.maxP95Ms,
    maxP99Ms: profile.maxP99Ms,
    maxResponseBytes: profile.maxResponseBytes,
    minTokenCount: 0,
    minTenantCount: 0,
    tokenFile: undefined,
    outputJson: undefined,
    confirmReadOnly: false,
  };
  const customPaths = [];

  for (let index = 0; index < args.length; index += 1) {
    const [name, inline] = optionParts(args[index]);
    if (name === '--confirm-read-only') {
      if (inline !== undefined) throw new CapacityConfigurationError('--confirm-read-only does not take a value');
      config.confirmReadOnly = true;
      continue;
    }
    if (name === '--profile') {
      const [, consumed] = optionValue(args, index, inline, name);
      index = consumed;
      continue;
    }
    const valued = new Set([
      '--base-url', '--path', '--tokens', '--output-json', '--concurrency', '--duration-seconds',
      '--warmup-seconds', '--timeout-ms', '--min-rps', '--max-error-rate', '--max-p95-ms',
      '--max-p99-ms', '--max-response-bytes', '--min-token-count', '--min-tenant-count',
    ]);
    if (!valued.has(name)) throw new CapacityConfigurationError(`unknown option: ${name}`);
    const [value, consumed] = optionValue(args, index, inline, name);
    index = consumed;
    switch (name) {
      case '--base-url': config.baseUrl = value; break;
      case '--path': customPaths.push(value); break;
      case '--tokens': config.tokenFile = value; break;
      case '--output-json': config.outputJson = value; break;
      case '--concurrency': config.concurrency = finiteNumber(value, name, 1, 10_000, true); break;
      case '--duration-seconds': config.durationSeconds = finiteNumber(value, name, 0.05, 86_400); break;
      case '--warmup-seconds': config.warmupSeconds = finiteNumber(value, name, 0, 3_600); break;
      case '--timeout-ms': config.timeoutMs = finiteNumber(value, name, 50, 120_000, true); break;
      case '--min-rps': config.minSuccessfulRps = finiteNumber(value, name, 0, 1_000_000); break;
      case '--max-error-rate': config.maxErrorRate = errorRate(value); break;
      case '--max-p95-ms': config.maxP95Ms = finiteNumber(value, name, 1, 120_000); break;
      case '--max-p99-ms': config.maxP99Ms = finiteNumber(value, name, 1, 120_000); break;
      case '--max-response-bytes': config.maxResponseBytes = finiteNumber(value, name, 1_024, 67_108_864, true); break;
      case '--min-token-count': config.minTokenCount = finiteNumber(value, name, 0, MAX_TOKEN_COUNT, true); break;
      case '--min-tenant-count': config.minTenantCount = finiteNumber(value, name, 0, MAX_TOKEN_COUNT, true); break;
    }
  }

  if (config.maxP95Ms > config.maxP99Ms) throw new CapacityConfigurationError('--max-p95-ms cannot exceed --max-p99-ms');
  const custom = customPaths.length > 0;
  config.paths = validateReadOnlyPaths(custom ? customPaths : config.paths, { custom, confirmed: config.confirmReadOnly });
  config.baseUrl = validateBaseUrl(config.baseUrl, Boolean(config.tokenFile));
  return config;
}

export async function loadBearerTokens(file) {
  if (!file) return [];
  const metadata = await stat(file).catch(error => {
    throw new CapacityConfigurationError(`cannot read token file metadata: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (!metadata.isFile()) throw new CapacityConfigurationError('token path must be a regular file');
  if (metadata.size > MAX_TOKEN_FILE_BYTES) throw new CapacityConfigurationError(`token file exceeds ${MAX_TOKEN_FILE_BYTES} bytes`);
  if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
    throw new CapacityConfigurationError('token file is group/world accessible; run chmod 600 before using it');
  }
  const raw = await readFile(file, 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new CapacityConfigurationError('token file must be valid JSON'); }
  const entries = Array.isArray(parsed) ? parsed : parsed?.tokens;
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_TOKEN_COUNT) {
    throw new CapacityConfigurationError(`token file must contain 1 to ${MAX_TOKEN_COUNT} entries`);
  }
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new CapacityConfigurationError(`token entry ${index} must be an object with tenantId and token`);
    }
    const tenantId = String(entry.tenantId ?? '').trim();
    const token = String(entry.token ?? '').trim();
    if (!tenantId || tenantId.length > 200 || /[\r\n\0]/.test(tenantId)) {
      throw new CapacityConfigurationError(`token entry ${index} has an invalid tenantId`);
    }
    if (!token || token.length > 16_384 || /[\s\0]/.test(token)) {
      throw new CapacityConfigurationError(`token entry ${index} has an invalid bearer token`);
    }
    return { tenantId, token };
  });
}

class ResponseTooLargeError extends Error {}

async function consumeResponse(response, maximumBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel().catch(() => {});
    throw new ResponseTooLargeError();
  }
  if (!response.body) return 0;
  const reader = response.body.getReader();
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return bytes;
    bytes += value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel().catch(() => {});
      throw new ResponseTooLargeError();
    }
  }
}

function networkCategory(error) {
  const code = String(error?.cause?.code ?? '').toUpperCase();
  if (code === 'ECONNREFUSED') return 'connection_refused';
  if (code === 'ECONNRESET' || code === 'EPIPE') return 'connection_reset';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  if (code.startsWith('ERR_TLS') || code.includes('CERT')) return 'tls';
  return error?.name === 'AbortError' ? 'aborted' : 'network';
}

function httpCategory(status) {
  if (status === 429) return 'http_429';
  if (status >= 500) return 'http_5xx';
  if (status >= 400) return 'http_4xx';
  if (status >= 300) return 'http_3xx';
  return 'http_other';
}

async function requestOnce({ baseUrl, path, token, timeoutMs, maximumBytes, runId }) {
  const started = performance.now();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const headers = {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
      'User-Agent': 'lingshu-capacity-acceptance/1',
      'X-Capacity-Run-Id': runId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const response = await fetch(new URL(path, baseUrl), {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: controller.signal,
    });
    let bytes;
    try {
      bytes = await consumeResponse(response, maximumBytes);
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        return { ok: false, status: response.status, category: 'response_too_large', bytes: maximumBytes, durationMs: performance.now() - started };
      }
      throw error;
    }
    const ok = response.status >= 200 && response.status < 300;
    return { ok, status: response.status, category: ok ? undefined : httpCategory(response.status), bytes, durationMs: performance.now() - started };
  } catch (error) {
    return { ok: false, status: undefined, category: timedOut ? 'timeout' : networkCategory(error), bytes: 0, durationMs: performance.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

class Measurements {
  constructor(timeoutMs) {
    this.attempts = 0;
    this.successes = 0;
    this.failures = 0;
    this.bytes = 0;
    this.latencyCount = 0;
    this.latencySum = 0;
    this.latencyMin = Number.POSITIVE_INFINITY;
    this.latencyMax = 0;
    this.latencyBuckets = new Uint32Array(Math.ceil(timeoutMs) + 2);
    this.statuses = Object.create(null);
    this.errors = Object.create(null);
  }

  record(result) {
    this.attempts += 1;
    this.bytes += result.bytes;
    if (result.ok) this.successes += 1;
    else {
      this.failures += 1;
      this.errors[result.category ?? 'unknown'] = (this.errors[result.category ?? 'unknown'] ?? 0) + 1;
    }
    const status = result.status === undefined ? 'none' : String(result.status);
    this.statuses[status] = (this.statuses[status] ?? 0) + 1;
    const latency = Math.max(0, result.durationMs);
    this.latencyCount += 1;
    this.latencySum += latency;
    this.latencyMin = Math.min(this.latencyMin, latency);
    this.latencyMax = Math.max(this.latencyMax, latency);
    const bucket = Math.min(this.latencyBuckets.length - 1, Math.ceil(latency));
    this.latencyBuckets[bucket] += 1;
  }

  percentile(fraction) {
    if (!this.latencyCount) return null;
    const rank = Math.max(1, Math.ceil(this.latencyCount * fraction));
    let seen = 0;
    for (let index = 0; index < this.latencyBuckets.length; index += 1) {
      seen += this.latencyBuckets[index];
      if (seen >= rank) return index;
    }
    return this.latencyBuckets.length - 1;
  }

  report(elapsedSeconds) {
    const rounded = (value, digits = 2) => {
      const factor = 10 ** digits;
      return Math.round(value * factor) / factor;
    };
    return {
      attempts: this.attempts,
      successes: this.successes,
      failures: this.failures,
      errorRate: this.attempts ? rounded(this.failures / this.attempts, 6) : 1,
      attemptedRps: elapsedSeconds > 0 ? rounded(this.attempts / elapsedSeconds) : 0,
      successfulRps: elapsedSeconds > 0 ? rounded(this.successes / elapsedSeconds) : 0,
      responseBytes: this.bytes,
      latencyMs: {
        min: this.latencyCount ? rounded(this.latencyMin) : null,
        mean: this.latencyCount ? rounded(this.latencySum / this.latencyCount) : null,
        p50: this.percentile(0.5),
        p95: this.percentile(0.95),
        p99: this.percentile(0.99),
        max: this.latencyCount ? rounded(this.latencyMax) : null,
      },
      statuses: Object.fromEntries(Object.entries(this.statuses).sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))),
      errors: Object.fromEntries(Object.entries(this.errors).sort(([left], [right]) => left.localeCompare(right))),
    };
  }
}

async function runPhase(config, tokens, seconds, measurements, control, runId) {
  if (seconds <= 0) return 0;
  const started = performance.now();
  const deadline = started + seconds * 1_000;
  const state = { active: 0, peak: 0 };
  const workers = Array.from({ length: config.concurrency }, (_, workerIndex) => (async () => {
    let pathIndex = workerIndex;
    const token = tokens.length ? tokens[workerIndex % tokens.length].token : undefined;
    while (!control.stopped && performance.now() < deadline) {
      const path = config.paths[pathIndex % config.paths.length];
      pathIndex += 1;
      state.active += 1;
      state.peak = Math.max(state.peak, state.active);
      let result;
      try {
        result = await requestOnce({
          baseUrl: config.baseUrl,
          path,
          token,
          timeoutMs: config.timeoutMs,
          maximumBytes: config.maxResponseBytes,
          runId,
        });
      } finally {
        state.active -= 1;
      }
      if (measurements) {
        measurements.aggregate.record(result);
        measurements.byPath.get(path).record(result);
      }
    }
  })());
  await Promise.all(workers);
  return { elapsedMs: performance.now() - started, peakInFlight: state.peak };
}

function thresholdCheck(name, actual, operator, threshold, passed) {
  return { name, actual, operator, threshold, passed };
}

function repositoryRevision() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    }).trim() || null;
  } catch {
    return null;
  }
}

export async function runCapacityAcceptance(config, tokens = [], { control = { stopped: false }, runId = randomUUID() } = {}) {
  const exercisedTokens = tokens.slice(0, config.concurrency);
  const tenantCount = new Set(exercisedTokens.map(entry => entry.tenantId)).size;
  if (exercisedTokens.length < config.minTokenCount) {
    throw new CapacityConfigurationError(`this concurrency exercises ${exercisedTokens.length} token entries; at least ${config.minTokenCount} are required`);
  }
  if (tenantCount < config.minTenantCount) {
    throw new CapacityConfigurationError(`token file covers ${tenantCount} tenants; at least ${config.minTenantCount} are required`);
  }

  const startedAt = new Date().toISOString();
  const gitRevision = repositoryRevision();
  if (config.warmupSeconds > 0) await runPhase(config, tokens, config.warmupSeconds, null, control, runId);
  const measurements = {
    aggregate: new Measurements(config.timeoutMs),
    byPath: new Map(config.paths.map(path => [path, new Measurements(config.timeoutMs)])),
  };
  const measured = await runPhase(config, tokens, config.durationSeconds, measurements, control, runId);
  const elapsedSeconds = measured.elapsedMs / 1_000;
  const aggregate = measurements.aggregate.report(elapsedSeconds);
  const paths = Object.fromEntries(config.paths.map(path => [path, measurements.byPath.get(path).report(elapsedSeconds)]));
  const checks = [
    thresholdCheck('successful_rps', aggregate.successfulRps, '>=', config.minSuccessfulRps, aggregate.successfulRps >= config.minSuccessfulRps),
    thresholdCheck('error_rate', aggregate.errorRate, '<=', config.maxErrorRate, aggregate.errorRate <= config.maxErrorRate),
    thresholdCheck('p95_latency_ms', aggregate.latencyMs.p95, '<=', config.maxP95Ms, aggregate.latencyMs.p95 !== null && aggregate.latencyMs.p95 <= config.maxP95Ms),
    thresholdCheck('p99_latency_ms', aggregate.latencyMs.p99, '<=', config.maxP99Ms, aggregate.latencyMs.p99 !== null && aggregate.latencyMs.p99 <= config.maxP99Ms),
    thresholdCheck('peak_in_flight', measured.peakInFlight, '>=', config.concurrency, measured.peakInFlight >= config.concurrency),
    thresholdCheck('path_coverage', Object.values(paths).filter(path => path.attempts > 0).length, '=', config.paths.length, Object.values(paths).every(path => path.attempts > 0)),
    thresholdCheck('token_count', tokens.length, '>=', config.minTokenCount, tokens.length >= config.minTokenCount),
    thresholdCheck('tenant_count', tenantCount, '>=', config.minTenantCount, tenantCount >= config.minTenantCount),
    thresholdCheck('interrupted', control.stopped, '=', false, !control.stopped),
  ];
  for (const [path, metrics] of Object.entries(paths)) {
    checks.push(
      thresholdCheck(`path_error_rate:${path}`, metrics.errorRate, '<=', config.maxErrorRate, metrics.errorRate <= config.maxErrorRate),
      thresholdCheck(`path_p95_latency_ms:${path}`, metrics.latencyMs.p95, '<=', config.maxP95Ms, metrics.latencyMs.p95 !== null && metrics.latencyMs.p95 <= config.maxP95Ms),
      thresholdCheck(`path_p99_latency_ms:${path}`, metrics.latencyMs.p99, '<=', config.maxP99Ms, metrics.latencyMs.p99 !== null && metrics.latencyMs.p99 <= config.maxP99Ms),
    );
  }

  return {
    schemaVersion: 1,
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    runner: {
      gitRevision,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    profile: config.profile,
    verdict: checks.every(check => check.passed) ? 'PASS' : 'FAIL',
    configuration: {
      baseUrl: config.baseUrl,
      method: 'GET',
      paths: config.paths,
      concurrency: config.concurrency,
      durationSeconds: config.durationSeconds,
      measuredSeconds: Math.round(elapsedSeconds * 100) / 100,
      warmupSeconds: config.warmupSeconds,
      timeoutMs: config.timeoutMs,
      maxResponseBytes: config.maxResponseBytes,
      authentication: tokens.length ? 'bearer_file' : 'none',
      availableTokenCount: tokens.length,
      exercisedTokenCount: exercisedTokens.length,
      exercisedTenantCount: tenantCount,
    },
    thresholds: {
      minSuccessfulRps: config.minSuccessfulRps,
      maxErrorRate: config.maxErrorRate,
      maxP95Ms: config.maxP95Ms,
      maxP99Ms: config.maxP99Ms,
      minTokenCount: config.minTokenCount,
      minTenantCount: config.minTenantCount,
    },
    peakInFlight: measured.peakInFlight,
    metrics: { aggregate, paths },
    errorsByCategory: aggregate.errors,
    checks,
    limitations: [
      'This run covers bounded GET traffic only; it does not exercise SSE, writes, queues, files, providers, publishing, generation, or paid actions.',
      'A PASS is evidence only for this exact target, profile, paths, token snapshot, thresholds, and time window.',
      'Client-observed concurrency and latency do not prove server CPU, memory, datastore headroom, tenant isolation, or recovery correctness.',
      'Tenant counts come from caller-supplied token labels and are not independently verified against server identity records.',
    ],
  };
}

export function capacityHelp() {
  return `Usage: node scripts/capacity-acceptance.mjs [options]

Safe default: GET /api/overseas/health and /api/overseas/ready on loopback
using profile safe-smoke-v1. No generation, publishing, send, upload, provider,
payment, or other mutation method is available from this tool.

Options:
  --profile <safe-smoke-v1|public-read-1000-v1>
  --base-url <origin>             Default http://127.0.0.1:8788
  --path <relative-api-path>      Repeat for custom GET paths
  --confirm-read-only             Required with every custom path set
  --tokens <secure-json-file>     [{"tenantId":"...","token":"..."}]
  --concurrency <1..10000>
  --duration-seconds <seconds>
  --warmup-seconds <seconds>
  --timeout-ms <milliseconds>
  --min-rps <successful-rps>
  --max-error-rate <0..1|percent>
  --max-p95-ms <milliseconds>
  --max-p99-ms <milliseconds>
  --max-response-bytes <bytes>
  --min-token-count <count>
  --min-tenant-count <count>
  --output-json <file>
  --help
`;
}

async function main() {
  try {
    const config = parseCapacityArgs(process.argv.slice(2));
    if (config.help) {
      process.stdout.write(capacityHelp());
      return;
    }
    const tokens = await loadBearerTokens(config.tokenFile);
    validateBaseUrl(config.baseUrl, tokens.length > 0);
    process.stderr.write(`[capacity] profile=${config.profile} target=${config.baseUrl} concurrency=${config.concurrency} warmup=${config.warmupSeconds}s duration=${config.durationSeconds}s paths=${config.paths.length} tokens=${tokens.length}\n`);
    const control = { stopped: false };
    let interrupted = false;
    const stop = () => { interrupted = true; control.stopped = true; };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    let report;
    try {
      report = await runCapacityAcceptance(config, tokens, { control });
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (config.outputJson) await writeFile(config.outputJson, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    process.stdout.write(serialized);
    process.exitCode = interrupted ? 130 : report.verdict === 'PASS' ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`capacity acceptance configuration failed: ${message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
