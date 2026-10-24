// Disposable UI acceptance adapter. It never writes upstream business records.
import http from 'node:http';
import { Readable } from 'node:stream';

const upstream = new URL(process.env.MINIAPP_FIXTURE_UPSTREAM || 'http://127.0.0.1:8790');
if (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1') throw Error('loopback_upstream_required');
const port = Number(process.env.MINIAPP_FIXTURE_PORT || 8792);
const projectId = process.env.MINIAPP_FIXTURE_PROJECT_ID;
const slotId = process.env.MINIAPP_FIXTURE_SLOT_ID;
if (!projectId || !slotId) throw Error('explicit_project_and_slot_required');
const origin = process.env.MINIAPP_FIXTURE_ORIGIN || 'http://127.0.0.1:5177';
const root = '/api/overseas/';
const login = await fetch(new URL(root + 'auth/local-preview-session', upstream), { method: 'POST', headers: { Origin: origin } });
const session = await login.json();
if (!login.ok || !session.token) throw Error('existing_local_login_unavailable');
const headers = { Authorization: 'Bearer ' + session.token };
const meResponse = await fetch(new URL(root + 'auth/me', upstream), { headers });
const identity = await meResponse.json();
const tenantId = identity.user?.tenantId;
if (!meResponse.ok || !tenantId) throw Error('existing_local_identity_required');
const projectResponse = await fetch(new URL(root + 'studio/projects/' + encodeURIComponent(projectId), upstream), { headers });
const project = await projectResponse.json();
const slot = project.spec?.shootingSlots?.find(item => item.slotId === slotId);
const reference = project.spec?.videoKickoff?.referenceAnalysis?.details?.find(item => item.shotId === slotId);
if (!projectResponse.ok || !slot?.id || !slot.requirements || !reference?.time) throw Error('existing_bound_shot_required');
const fixture = {
  id: 'isolated-miniapp-benchmark-preview', origin: 'script_gap', title: '【隔离验收】工厂灌装对标分镜',
  productLabel: '隔离验收样本 · 不写入原账号', themeTitle: project.title,
  shotBrief: reference.visual, suggestedDurationSec: Math.round(slot.duration * 100) / 100, ratio: project.spec.ratio || '9:16',
  sourceProjectId: project.id, sourceStoryboardSlotId: slot.slotId, sourceShotId: slot.id,
  sourceAssemblyId: project.spec.activeAssemblyId, requirements: slot.requirements, soundMode: 'silent',
  createdAt: new Date().toISOString(), uploadedMaterialIds: [],
};
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
const server = http.createServer(async (req, res) => {
  try {
    if (new URL(req.url, upstream).origin !== upstream.origin) { json(res, 400, { error: 'fixed_upstream_required' }); return; }
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    const loginRequest = req.method === 'POST' && path === root + 'auth/local-preview-session';
    if (req.method !== 'GET' && req.method !== 'HEAD' && !loginRequest) {
      json(res, 405, { error: 'isolated_acceptance_read_only' }); return;
    }
    const outgoing = {};
    for (const key of ['authorization', 'range', 'origin', 'content-type']) if (req.headers[key]) outgoing[key] = req.headers[key];
    const response = await fetch(new URL(req.url, upstream), {
      method: req.method, headers: outgoing, ...(loginRequest ? { body: '{}' } : {}), redirect: 'manual',
    });
    const taskList = path === root + 'studio/shooting-tasks';
    const queue = path === root + 'mobile-workbench/queue';
    if (response.ok && (taskList || queue)) {
      const verification = await fetch(new URL(root + 'auth/me', upstream), { headers: outgoing });
      const account = await verification.json();
      if (!verification.ok || account.user?.tenantId !== tenantId) { json(res, 403, { error: 'fixture_identity_mismatch' }); return; }
      const data = await response.json();
      json(res, response.status, taskList ? [...data, fixture] : { ...data, shooting: [...(data.shooting || []), fixture] });
      return;
    }
    const selected = {};
    for (const key of ['content-type', 'content-range', 'accept-ranges', 'cache-control', 'location']) {
      const value = response.headers.get(key); if (value) selected[key] = value;
    }
    res.writeHead(response.status, selected);
    if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
  } catch { if (!res.headersSent) json(res, 502, { error: 'isolated_upstream_unavailable' }); else res.end(); }
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({
  mode: 'ISOLATED_ACCEPTANCE_ONLY', port, upstream: upstream.origin, taskId: fixture.id,
  projectId, slotId, referenceRange: reference.time, upstreamWritesEnabled: false,
})));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
