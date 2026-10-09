import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('server/routes/draftReply.ts', 'utf8');
const auditCalls = Array.from(source.matchAll(/await recordMemoryAudit\(\{([\s\S]*?)\n\s*\}\);/g)).map(match => match[1]);

assert.ok(auditCalls.length >= 2, 'success and safe-fallback generation paths must both be audited');
for (const call of auditCalls) {
  assert.match(call, /knowledgeVersion:\s*context\.enterpriseFactVersion\s*\|\|\s*''/, 'every reply audit must use the server-retrieved enterprise fact version');
  assert.doesNotMatch(call, /body\.knowledgeVersion/, 'a request body must never choose the audited knowledge version');
}
assert.doesNotMatch(source, /knowledgeVersion:\s*String\(body\.knowledgeVersion/, 'no draft-reply path may trust a caller-provided knowledge version');

console.log('draft reply enterprise fact-version audit contract tests passed');
