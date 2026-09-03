import 'dotenv/config';
import { readOAuthConfig, writeOAuthConfig } from '../server/lib/oauthConfig.js';

const current = readOAuthConfig();
const next = writeOAuthConfig({}, Number(current.revision || 0));

console.log(JSON.stringify({
  ok: true,
  revision: next.revision,
  credentialVersion: next.credentialVersion,
  reconnectRequired: Object.entries(next.credentialState || {})
    .filter(([, state]) => state === 'reconnect_required')
    .map(([platform]) => platform),
}));
