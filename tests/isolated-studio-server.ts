/** Test launcher only: copied into a mktemp checkout, never use with live data. */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';

const root = fs.realpathSync(process.cwd());
if (!/^\/(?:private\/)?tmp\/lingshu-e2e-[\w-]+$/.test(root)) throw new Error('This launcher only runs inside an isolated mktemp checkout');
process.env.NODE_ENV = 'test';
process.env.PB_URL = 'http://127.0.0.1:65530';
process.env.SUBSCRIPTION_ENFORCED = 'true';
process.env.ASSET_ACCESS_SECRET = randomBytes(32).toString('hex');
const data = path.join(root, 'data'); fs.mkdirSync(data, { recursive: true });
if (process.env.ACCEPTANCE_PAID_GUARD === 'true') {
  const { installAcceptanceBudget } = await import('./acceptance-budget.js');
  installAcceptanceBudget(root);
}
const accounts = path.join(data, 'local-auth-accounts.json');
if (!fs.existsSync(accounts)) {
  const salt = randomBytes(16).toString('hex');
  fs.writeFileSync(accounts, JSON.stringify([{ userId: 'local_user_studio_test', tenantId: 'local_tenant_studio_test', email: 'studio-test@example.invalid', name: '隔离验收企业', role: 'super_admin', accountType: 'customer', salt, passwordHash: scryptSync('Local-Acceptance-Only-2026', salt, 64).toString('hex'), createdAt: new Date().toISOString() }]), { mode: 0o600 });
}
const { studioRouter } = await import('../server/routes/studio.js');
const { enterpriseRouter } = await import('../server/routes/enterprise.js');
const { authRouter } = await import('../server/routes/auth.js');
const { syncAssetSession, requireScopedAsset } = await import('../server/lib/assetAccess.js');
const app = express(); app.use(express.json({ limit: '120mb' })); app.use(syncAssetSession);
app.get('/api/overseas/health', (_req, res) => res.json({ status: 'ok', isolated: true, backgroundJobs: false }));
app.use('/api/overseas/auth', authRouter);
app.use('/api/overseas/enterprise', enterpriseRouter);
app.use('/api/overseas/studio', studioRouter);
for (const folder of ['media', 'bgm', 'tts', 'covers', 'voice-samples']) app.use(`/${folder}`, requireScopedAsset, express.static(path.join(data, folder)));
app.use('/api', (_req, res) => res.status(503).json({ error: '该服务不在隔离创作验收环境中，未连接生产' }));
app.use(express.static(path.join(root, 'dist')));
app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
app.listen(8793, '127.0.0.1', () => console.log('Isolated studio ready at http://127.0.0.1:8793; no schedulers, no production data'));
