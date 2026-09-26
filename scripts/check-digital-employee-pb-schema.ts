/** Read-only contract check against a migrated PocketBase instance. */
const base = String(process.env.PB_URL || '').replace(/\/$/, '');
const identity = String(process.env.PB_ADMIN_EMAIL || '');
const password = String(process.env.PB_ADMIN_PASSWORD || '');
if (!base || !identity || !password) throw Error('PB_URL, PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD are required');

const login = await fetch(`${base}/api/collections/_superusers/auth-with-password`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity, password }),
});
if (!login.ok) throw Error(`PocketBase admin login failed (${login.status})`);
const { token } = await login.json() as { token: string };
for (const [collection, filter, sort] of [
  ['workflow_runs', 'tenant_id = "schema-check"', '-started_at'],
  ['trend_videos', 'tenantId = "schema-check"', '-crawledAt'],
] as const) {
  const query = new URLSearchParams({ filter, sort, page: '1', perPage: '1' });
  const response = await fetch(`${base}/api/collections/${collection}/records?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw Error(`${collection} sort/filter schema mismatch (${response.status})`);
}
console.log('Digital Employee PocketBase query schema passed');
