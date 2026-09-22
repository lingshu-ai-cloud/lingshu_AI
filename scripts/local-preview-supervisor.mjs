import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeExecutable = process.execPath;
const shuttingDown = { value: false };

const services = [
  {
    name: 'backend',
    // The always-on preview favors availability over server hot reload. A full
    // repository watcher can restart this large backend repeatedly while other
    // tasks edit unrelated files, leaving Vite with a temporary 502 upstream.
    args: [path.join(repositoryRoot, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts'],
    env: { PORT: '8790', NODE_USE_ENV_PROXY: '1' },
    // Health monitoring must stay cheap and independent of business data.
    // The startup-hub snapshot performs authenticated aggregation and can be
    // temporarily slow while background jobs are busy; treating that as a
    // process failure caused healthy backends to be killed, leaving a white UI.
    probe: { url: 'http://127.0.0.1:8790/api/overseas/health' },
  },
  {
    name: 'frontend',
    args: [path.join(repositoryRoot, 'node_modules/vite/bin/vite.js'), '--host', '0.0.0.0', '--port', '5177', '--strictPort'],
    env: { DEV_API_TARGET: 'http://127.0.0.1:8790' },
    probe: { url: 'http://127.0.0.1:5177/startup-hub-preview' },
  },
];

function log(message) {
  process.stdout.write(`[${new Date().toISOString()}] ${message}\n`);
}

function start(service) {
  if (shuttingDown.value) return;
  service.failures = 0;
  const child = spawn(nodeExecutable, service.args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...service.env },
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
    const response = await fetch(service.probe.url, { headers: service.probe.headers, signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function monitor() {
  if (shuttingDown.value) return;
  for (const service of services) {
    if (!service.child) continue;
    if (await healthy(service)) {
      service.failures = 0;
      continue;
    }
    service.failures = (service.failures || 0) + 1;
    if (service.failures >= 3) {
      log(`${service.name} failed three health checks; restarting`);
      service.failures = 0;
      terminate(service);
    }
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

const [backend, frontend] = services;
start(backend);

async function startFrontendAfterBackend() {
  for (let attempt = 0; attempt < 30 && !shuttingDown.value; attempt += 1) {
    if (await healthy(backend)) break;
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  start(frontend);
}

void startFrontendAfterBackend();
setTimeout(() => {
  void monitor();
  setInterval(() => void monitor(), 15_000);
}, 12_000);
