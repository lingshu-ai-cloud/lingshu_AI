import path from 'node:path';
import { config } from 'dotenv';
import { contentExternalConnectivityPreflight, staticContentExternalPreflight } from '../server/runtime/contentExternalPreflight.js';

config({ path: path.resolve('.env.local'), quiet: true });
const live = process.argv.includes('--connectivity');
const report = live
  ? await contentExternalConnectivityPreflight()
  : staticContentExternalPreflight();
process.stdout.write(`${JSON.stringify({ mode: live ? 'read_only_connectivity' : 'configuration', ...report }, null, 2)}\n`);
if (!report.ready) process.exitCode = 1;
