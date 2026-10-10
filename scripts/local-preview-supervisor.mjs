import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = path.resolve(process.env.LINGSHU_PREVIEW_ROOT || repositoryRoot);
const nodeExecutable = process.execPath;
const shuttingDown = { value: false };
let monitoring = false;
let backendRestartTimer;
let repositoryRevision = '';
const startupGraceMs = Number(process.env.LINGSHU_PREVIEW_STARTUP_GRACE_MS || 120_000);
const healthCheckTimeoutMs = Number(process.env.LINGSHU_PREVIEW_HEALTH_TIMEOUT_MS || 20_000);
const maxConsecutiveHealthFailures = Number(process.env.LINGSHU_PREVIEW_HEALTH_FAILURE_LIMIT || 5);
const forceOptimizeDependencies = process.env.LINGSHU_PREVIEW_FORCE_OPTIMIZE === '1';
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
      PORT: '8790',
      LINGSHU_LOCAL_PORT: '8790',
      NODE_USE_ENV_PROXY: '1',
      LINGSHU_LOCAL_PREVIEW: '1',
      // The preview exercises the real task lifecycle, including queue recovery
      // after a backend restart. Use the combined role until the persistent
      // queue/scheduler migration makes a split local worker safe.
      PROCESS_ROLE: 'all',
      ENABLE_LOCAL_DEV_FALLBACK: 'true',
      // Local preview sessions must survive backend hot restarts. The server's
      // secure default is intentionally process-ephemeral, so the supervisor
      // supplies a private, machine-local secret only for this dev service.
      LOCAL_DEMO_TOKEN_SECRET: localAuthSecret,
      LOCAL_DEMO_TOKEN_TTL_SECONDS: '86400',
      // This is a local-record selector, never a credential. The auth route
      // accepts it only in the supervised, non-production preview process.
      LINGSHU_PREVIEW_AUTH_EMAIL: localPreviewAuthEmail,
    },
    // Health monitoring must stay cheap and independent of business data.
    // Business queries can be temporarily slow while background jobs are busy;
    // treating that as a process failure can kill a healthy backend and leave a white UI.
    probe: { url: 'http://127.0.0.1:8790/api/overseas/health', expectText: '"status":"ok"' },
  },
  {
    name: 'frontend',
    args: [
      path.join(runtimeRoot, 'node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      '5177',
      '--strictPort',
      ...(forceOptimizeDependencies ? ['--force'] : []),
    ],
    env: {
      DEV_API_TARGET: 'http://127.0.0.1:8790',
      VITE_LINGSHU_LOCAL_PREVIEW: '1',
    },
    // Serve source in the local workspace. A dist preview can keep an old HTML
    // document while a build removes its hashed chunks, which Safari presents
    // as an intermittent white screen.
    probe: { url: 'http://127.0.0.1:5177/', expectText: 'id="root"', verifyModuleScripts: true },
  },
  {
    name: 'account-hub-frontend',
    args: [
      path.join(runtimeRoot, 'node_modules/vite/bin/vite.js'),
      '--config',
      path.join(runtimeRoot, 'apps/account-hub/vite.config.ts'),
      '--host',
      '127.0.0.1',
      '--port',
      '5178',
      '--strictPort',
      ...(forceOptimizeDependencies ? ['--force'] : []),
    ],
    env: {
      DEV_API_TARGET: 'http://127.0.0.1:8790',
      ACCOUNT_HUB_DEV_PORT: '5178',
    },
    probe: { url: 'http://127.0.0.1:5178/', expectText: 'id="root"', verifyModuleScripts: true },
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
  const child = spawn(nodeExecutable, service.args, {
    cwd: runtimeRoot,
    env: localNetworkEnvironment({ ...service.env, APP_BUILD_SHA: revision, VITE_APP_BUILD_SHA: revision }),
    stdio: 'inherit',
    detached: true,
  });
  service.child = child;
  log(`${service.name} started (pid ${child.pid})`);
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

for (const directory of ['server', 'shared']) {
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
    const modules = await Promise.all(moduleSources.map(source => fetch(new URL(source, service.probe.url), {
      headers: service.probe.headers,
      signal: controller.signal,
    })));
    if (!modules.every(module => module.ok)) return false;
    const moduleBodies = await Promise.all(modules.map(module => module.text()));
    const optimizedDependencies = [...new Set(moduleBodies.flatMap(source =>
      [...source.matchAll(/["'](\/node_modules\/\.vite\/deps\/[^"']+)["']/g)].map(match => match[1]),
    ))];
    const dependencies = await Promise.all(optimizedDependencies.map(source => fetch(new URL(source, service.probe.url), {
      headers: service.probe.headers,
      signal: controller.signal,
    })));
    return dependencies.every(dependency => dependency.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
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
