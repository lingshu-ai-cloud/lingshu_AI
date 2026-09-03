import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const authPosition = index.indexOf("app.use(digitalHumanWorkerIngress, (req, res, next)");
const smallParserPosition = index.indexOf("app.use(digitalHumanWorkerIngress, express.json({ limit: '64kb' }))");
const globalParserPosition = index.indexOf("app.use(express.json({\n  limit: '120mb'");

assert.ok(authPosition >= 0, 'worker ingress must have header-only pre-authentication');
assert.ok(smallParserPosition > authPosition, 'small JSON parser must run only after Worker authentication');
assert.ok(globalParserPosition > smallParserPosition, 'Worker pre-authentication must run before the global 120 MB parser');
assert.match(index, /authenticateDigitalHumanWorker\(req\.headers\.authorization\)/);

console.log('digital human worker ingress contract tests passed');
