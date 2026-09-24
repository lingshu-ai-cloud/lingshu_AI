import path from 'node:path';
import fs from 'node:fs';
import { inspectPersonReplacementPair } from '../server/lib/personReplacementMediaQuality.js';

const [source, candidate, output] = process.argv.slice(2);
if (!source || !candidate) {
  console.error('Usage: tsx scripts/person-replacement-quality.ts <source-video> <candidate-video> [report.json]');
  process.exit(2);
}
const report = await inspectPersonReplacementPair(path.resolve(source), path.resolve(candidate));
const json = `${JSON.stringify(report, null, 2)}\n`;
if (output) fs.writeFileSync(path.resolve(output), json);
process.stdout.write(json);
