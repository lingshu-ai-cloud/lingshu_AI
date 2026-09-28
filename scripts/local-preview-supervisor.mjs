import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = path.resolve(process.env.LINGSHU_PREVIEW_ROOT || repositoryRoot);
const nodeExecutable = process.execPath;
const shuttingDown = { value: false };
let monitoring = false;

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
      NODE_USE_ENV_PROXY: '1',
      // The preview exercises the real task lifecycle, including queue recovery
      // after a backend restart. Use the combined role until the persistent
      // queue/scheduler migration makes a split local worker safe.
      PROCESS_ROLE: 'all',
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
      '0.0.0.0',
      '--port',
      '5177',
      '--strictPort',
      '--force',
    ],
    env: { DEV_API_TARGET: 'http://127.0.0.1:8790' },
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
      '--force',
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
  const child = spawn(nodeExecutable, service.args, {
    cwd: runtimeRoot,
    env: localNetworkEnvironment(service.env),
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
  const timer = setTimeout(() => controller.abort(), 5_000);
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
      if (await healthy(service)) {
        service.failures = 0;
        return;
      }
      service.failures = (service.failures || 0) + 1;
      log(`${service.name} health check failed (${service.failures}/3)`);
      if (service.failures >= 3) {
        log(`${service.name} failed three health checks; restarting`);
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

const [backend, ...frontends] = services;
start(backend);

async function startFrontendsAfterBackend() {
  let attempt = 0;
  while (!shuttingDown.value && !(await healthy(backend))) {
    attempt += 1;
    if (attempt === 30 || attempt % 60 === 0) {
      log(`backend is not ready after ${attempt} seconds; keeping frontends offline to avoid a broken preview`);
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  if (shuttingDown.value) return;
  for (const frontend of frontends) start(frontend);
}

void startFrontendsAfterBackend();
setTimeout(() => {
  void monitor();
  setInterval(() => void monitor(), 15_000);
}, 12_000);
