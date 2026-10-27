import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { loadLocalPreviewProviderEnvironment, providerEnvironmentForService } from './local-preview-provider-env.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = path.resolve(process.env.LINGSHU_PREVIEW_ROOT || repositoryRoot);
const providerConfiguration = loadLocalPreviewProviderEnvironment({ runtimeRoot });
if (providerConfiguration.loadedKeys.length) {
  // Key names only. Never log the providerEnv object or any environment values.
  log(`backend provider configuration loaded: ${providerConfiguration.loadedKeys.join(', ')}`);
}
const nodeExecutable = process.execPath;
const shuttingDown = { value: false };
let monitoring = false;
let backendRestartTimer;
let repositoryRevision = '';
const startupGraceMs = Number(process.env.LINGSHU_PREVIEW_STARTUP_GRACE_MS || 120_000);
const healthCheckTimeoutMs = Number(process.env.LINGSHU_PREVIEW_HEALTH_TIMEOUT_MS || 20_000);
// Exact video analysis can keep the combined local worker busy for several
// minutes while provider chunks complete. A crashed child still restarts from
// its exit event; this larger probe window prevents killing healthy paid work.
const maxConsecutiveHealthFailures = Number(process.env.LINGSHU_PREVIEW_HEALTH_FAILURE_LIMIT || 12);
const forceOptimizeDependencies = process.env.LINGSHU_PREVIEW_FORCE_OPTIMIZE === '1';
// One layer beyond /src/main.tsx reaches App and its shell providers. Their
// optimized imports are always probed below, without crawling the entire lazy
// page graph every 15 seconds.
const maxFrontendModuleDepth = Number(process.env.LINGSHU_PREVIEW_MODULE_DEPTH || 1);
const maxFrontendModuleCount = Number(process.env.LINGSHU_PREVIEW_MODULE_LIMIT || 160);
function previewPort(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1024 || value > 65535) throw new Error(`${name} must be a non-privileged TCP port`);
  return String(value);
}
const backendPort = previewPort('LINGSHU_PREVIEW_BACKEND_PORT', 8790);
const frontendPort = previewPort('LINGSHU_PREVIEW_FRONTEND_PORT', 5177);
const accountHubPort = previewPort('LINGSHU_PREVIEW_ACCOUNT_HUB_PORT', 5178);
if (new Set([backendPort, frontendPort, accountHubPort]).size !== 3) throw new Error('Local preview services must use distinct ports');
const backendOrigin = `http://127.0.0.1:${backendPort}`;
const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
const localPreviewAuthEmail = String(
  process.env.LINGSHU_PREVIEW_AUTH_EMAIL || 'beauty-showcase@local.test',
).trim().toLowerCase();

function stableLocalAuthSecret() {
  const configured = String(process.env.LOCAL_DEMO_TOKEN_SECRET || '').trim();
  if (configured) return configured;
  const secretFile = path.resolve(
    process.env.LINGSHU_PREVIEW_AUTH_SECRET_FILE
      || path.join(os.homedir(), '.lingshu-ai', 'local-preview-auth-secret'),
  );
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const secret = randomBytes(48).toString('base64url');
  fs.mkdirSync(path.dirname(secretFile), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(secretFile, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${secret}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return secret;
}

const localAuthSecret = stableLocalAuthSecret();

function currentRevision() {
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: runtimeRoot, encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /^[0-9a-f]{40}$/i.test(revision) ? revision : null;
  } catch {
    // A busy working tree can make git briefly exceed the timeout. Absence of a
    // trustworthy SHA is not a revision change and must never restart services.
    return null;
  }
}

function localNetworkEnvironment(extra = {}) {
  const existing = String(process.env.NO_PROXY || process.env.no_proxy || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const noProxy = [...new Set([...existing, '127.0.0.1', 'localhost', '::1'])].join(',');
  return {
    ...process.env,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
    ...extra,
  };
}

const services = [
  {
    name: 'backend',
    // The always-on preview favors availability over server hot reload. A full
    // repository watcher can restart this large backend repeatedly while other
    // tasks edit unrelated files, leaving Vite with a temporary 502 upstream.
    args: [path.join(runtimeRoot, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts'],
    env: {
      NODE_ENV: 'development',
      PORT: backendPort,
      LINGSHU_LOCAL_PORT: backendPort,
      // The customer-isolation guard authorizes the provider hostname itself.
      // Routing that request through an ambient loopback proxy changes the
      // socket target to the proxy and is correctly rejected by the guard.
      NODE_USE_ENV_PROXY: '0',
      LINGSHU_LOCAL_PREVIEW: '1',
      LINGSHU_LOCAL_PREVIEW_ORIGINS: frontendOrigin,
      // The preview exercises the real task lifecycle, including queue recovery
      // after a backend restart. Use the combined role until the persistent
      // queue/scheduler migration makes a split local worker safe.
      PROCESS_ROLE: 'all',
      ENABLE_LOCAL_DEV_FALLBACK: 'true',
      // Opening the supervised app also opens its local background runtime.
      // There is no front-end setup switch: readiness below proves that the
      // weekly scanner really started before this process is kept healthy.
      DIGITAL_EMPLOYEE_RUNTIME_ENABLED: 'true',
      STARTER_198_ORCHESTRATOR_WORKER_ENABLED: 'true',
      STARTER_PUBLICATION_PACKAGE_WORKER_ENABLED: 'true',
      STARTER_QUOTE_ARTIFACT_WORKER_ENABLED: 'true',
      SOCIAL_WEEKLY_EXECUTION_WORKER_ENABLED: 'true',
      CONTENT_WORKER_SELF_HEAL_ENABLED: 'true',
      LINGSHU_LOCAL_PRODUCTION_RUNTIME: '1',
      LINGSHU_LOCAL_PAID_GENERATION_ENABLED: '1',
      // A worktree preview must migrate with the files from the exact source
      // revision it is running. A machine-level .env.local may point at a
      // different checkout and silently skip or misapply migrations.
      PB_MIGRATIONS_DIR: path.join(runtimeRoot, 'pb_migrations'),
      // Local preview sessions must survive backend hot restarts. The server's
      // secure default is intentionally process-ephemeral, so the supervisor
      // supplies a private, machine-local secret only for this dev service.
      LOCAL_DEMO_TOKEN_SECRET: localAuthSecret,
      LOCAL_DEMO_TOKEN_TTL_SECONDS: '86400',
      // This is a local-record selector, never a credential. The auth route
      // accepts it only in the supervised, non-production preview process.
      LINGSHU_PREVIEW_AUTH_EMAIL: localPreviewAuthEmail,
    },
    // A live HTTP socket is insufficient: the app is usable only after its
    // storage and the in-process content workers have passed readiness.
    probe: { url: `${backendOrigin}/api/overseas/ready`, expectText: '"status":"ready"' },
  },
  {
    name: 'frontend',
    vite: true,
    args: [
      path.join(runtimeRoot, 'node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      frontendPort,
      '--strictPort',
    ],
    env: {
      DEV_API_TARGET: backendOrigin,
      VITE_LINGSHU_LOCAL_PREVIEW: '1',
      VITE_LINGSHU_LOCAL_PREVIEW_ORIGIN: frontendOrigin,
    },
    // Serve source in the local workspace. A dist preview can keep an old HTML
    // document while a build removes its hashed chunks, which Safari presents
    // as an intermittent white screen.
    probe: { url: `${frontendOrigin}/`, expectText: 'id="root"', verifyModuleScripts: true },
  },
  {
    name: 'account-hub-frontend',
    vite: true,
    args: [
      path.join(runtimeRoot, 'node_modules/vite/bin/vite.js'),
      '--config',
      path.join(runtimeRoot, 'apps/account-hub/vite.config.ts'),
      '--host',
      '127.0.0.1',
      '--port',
      accountHubPort,
      '--strictPort',
    ],
    env: {
      DEV_API_TARGET: backendOrigin,
      ACCOUNT_HUB_DEV_PORT: accountHubPort,
    },
    probe: { url: `http://127.0.0.1:${accountHubPort}/`, expectText: 'id="root"', verifyModuleScripts: true },
  },
];

function log(message) {
  process.stdout.write(`[${new Date().toISOString()}] ${message}\n`);
}

function start(service) {
  if (shuttingDown.value) return;
  service.failures = 0;
  service.startedAt = Date.now();
  const revision = currentRevision() || repositoryRevision;
  const rebuildOptimizedDependencies = Boolean(
    service.vite && (forceOptimizeDependencies || service.forceOptimizeNextStart),
  );
  const args = rebuildOptimizedDependencies
    ? [...service.args, '--force']
    : service.args;
  service.forceOptimizeNextStart = false;
  const child = spawn(nodeExecutable, args, {
    cwd: runtimeRoot,
    env: localNetworkEnvironment({ ...providerEnvironmentForService(service.name, providerConfiguration), ...service.env, APP_BUILD_SHA: revision, VITE_APP_BUILD_SHA: revision }),
    stdio: 'inherit',
    detached: true,
  });
  service.child = child;
  log(`${service.name} started (pid ${child.pid}${rebuildOptimizedDependencies ? ', rebuilding optimized dependencies' : ''})`);
  child.once('exit', (code, signal) => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* The process group is already gone. */ }
    service.child = undefined;
    if (shuttingDown.value) return;
    log(`${service.name} exited (${signal || code}); restarting in 2 seconds`);
    service.restartTimer = setTimeout(() => start(service), 2_000);
  });
}

function scheduleBackendRestart(reason) {
  if (shuttingDown.value) return;
  if (backendRestartTimer) clearTimeout(backendRestartTimer);
  backendRestartTimer = setTimeout(() => {
    backendRestartTimer = undefined;
    const backend = services.find(service => service.name === 'backend');
    if (!backend?.child) return;
    log(`backend source changed (${reason}); restarting with the latest code`);
    terminate(backend);
  }, 800);
}

for (const directory of (process.env.LINGSHU_PREVIEW_BACKEND_SOURCE_WATCH === '0' ? [] : ['server', 'shared'])) {
  try {
    fs.watch(path.join(runtimeRoot, directory), { recursive: true }, (_event, filename) => {
      if (!filename || /(?:^|\/)(?:data|dist|node_modules)(?:\/|$)/.test(filename)) return;
      if (/\.(?:test|fixture)\.(?:ts|tsx|js|mjs)$/.test(filename)) return;
      if (/\.(?:ts|tsx|js|mjs|json)$/.test(filename)) scheduleBackendRestart(`${directory}/${filename}`);
    });
  } catch (error) {
    log(`backend ${directory} source watch unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

repositoryRevision = currentRevision() || '';
setInterval(() => {
  const next = currentRevision();
  if (!next || next === repositoryRevision) return;
  if (!repositoryRevision) {
    repositoryRevision = next;
    return;
  }
  repositoryRevision = next;
  log(`repository revision changed to ${next.slice(0, 8)}; restarting preview services`);
  for (const service of services) terminate(service);
}, 3_000).unref();

function terminate(service) {
  const child = service.child;
  if (!child) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  setTimeout(() => {
    if (service.child !== child) return;
    log(`${service.name} did not exit in time; force killing its process group`);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }, 3_000).unref();
}

async function healthy(service) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), healthCheckTimeoutMs);
  try {
    const response = await fetch(service.probe.url, {
      headers: service.probe.headers,
      signal: controller.signal,
    });
    if (!response.ok) return false;
    if (!service.probe.expectText) return true;
    const body = await response.text();
    if (!body.includes(service.probe.expectText)) return false;
    if (!service.probe.verifyModuleScripts) return true;
    const moduleSources = [...body.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/gi)]
      .map(match => match[1]);
    if (!moduleSources.length) return false;
    return verifyFrontendModuleGraph(service, moduleSources, controller.signal);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function referencedFrontendModules(source) {
  return [...new Set(
    [...source.matchAll(/["'](\/(?:src\/|@fs\/|@vite\/|node_modules\/\.vite\/deps\/)[^"']+)["']/g)]
      .map(match => match[1]),
  )];
}

async function fetchFrontendModule(service, source, signal) {
  const response = await fetch(new URL(source, service.probe.url), {
    headers: service.probe.headers,
    signal,
  });
  const body = await response.text();
  const outdatedOptimizedDependency = response.status === 504
    && (/Outdated Optimize Dep/i.test(response.statusText) || /Outdated Optimize Dep/i.test(body));
  if (!response.ok && outdatedOptimizedDependency) {
    // Vite keeps serving the already-transformed source graph after its
    // optimized dependency directory is removed or invalidated. A normal
    // restart can reuse the same bad metadata, so make the next launch rebuild
    // the dependency graph. This is a generated local cache only.
    service.forceOptimizeNextStart = true;
  }
  return { ok: response.ok, body };
}

async function verifyFrontendModuleGraph(service, entrySources, signal) {
  const visited = new Set();
  let checked = 0;
  let currentSources = entrySources;

  for (let depth = 0; depth <= maxFrontendModuleDepth && currentSources.length; depth += 1) {
    const sourceBatch = [...new Set(currentSources)]
      .filter(source => !visited.has(source))
      .slice(0, Math.max(0, maxFrontendModuleCount - checked));
    if (!sourceBatch.length) break;
    sourceBatch.forEach(source => visited.add(source));
    checked += sourceBatch.length;

    const modules = await Promise.all(sourceBatch.map(source => fetchFrontendModule(service, source, signal)));
    if (!modules.every(module => module.ok)) return false;

    const references = [...new Set(modules.flatMap(module => referencedFrontendModules(module.body)))];
    const optimizedDependencies = references
      .filter(source => source.startsWith('/node_modules/.vite/deps/'))
      .filter(source => !visited.has(source))
      .slice(0, Math.max(0, maxFrontendModuleCount - checked));
    optimizedDependencies.forEach(source => visited.add(source));
    checked += optimizedDependencies.length;
    if (optimizedDependencies.length) {
      const dependencies = await Promise.all(
        optimizedDependencies.map(source => fetchFrontendModule(service, source, signal)),
      );
      if (!dependencies.every(dependency => dependency.ok)) return false;
    }

    if (checked >= maxFrontendModuleCount) break;
    currentSources = references.filter(source => !source.startsWith('/node_modules/.vite/deps/'));
  }
  return true;
}

async function monitor() {
  if (shuttingDown.value || monitoring) return;
  monitoring = true;
  try {
    await Promise.all(services.map(async service => {
      if (!service.child) return;
      if (Date.now() - (service.startedAt || 0) < startupGraceMs) return;
      if (await healthy(service)) {
        service.failures = 0;
        return;
      }
      if (service.forceOptimizeNextStart) {
        log(`${service.name} has an outdated Vite optimized dependency; restarting once with --force`);
        service.failures = 0;
        terminate(service);
        return;
      }
      service.failures = (service.failures || 0) + 1;
      log(`${service.name} health check failed (${service.failures}/${maxConsecutiveHealthFailures})`);
      if (service.failures >= maxConsecutiveHealthFailures) {
        log(`${service.name} failed ${maxConsecutiveHealthFailures} consecutive health checks; restarting`);
        service.failures = 0;
        terminate(service);
      }
    }));
  } finally {
    monitoring = false;
  }
}

function stop() {
  if (shuttingDown.value) return;
  shuttingDown.value = true;
  log('stopping local preview services');
  for (const service of services) {
    if (service.restartTimer) clearTimeout(service.restartTimer);
    terminate(service);
  }
  setTimeout(() => process.exit(0), 4_000).unref();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGHUP', stop);

// Serve the application shell immediately. Backend startup can be expensive on
// a cold TypeScript cache; keeping Vite offline during that work presents a
// blank/unreachable page even though the frontend itself is healthy.
for (const service of services) start(service);
setTimeout(() => {
  void monitor();
  setInterval(() => void monitor(), 15_000);
}, 12_000);
