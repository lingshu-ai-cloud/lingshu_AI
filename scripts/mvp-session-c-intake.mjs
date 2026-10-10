import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const scopeKeys = ['tenantId', 'taskId', 'runId', 'version'];
const roles = ['reference', 'script', 'storyboard', 'voiceover', 'digitalHuman', 'aigc', 'enterpriseMaterial', 'finalVideo'];
// This offline intake detects missing or conflicting handoff evidence. Editable
// JSON and byte hashes cannot certify provider origin or creative acceptance.
export async function inspectSessionCIntake(input, baseDir = process.cwd()) {
  const blockers = [];
  const expected = input?.expectedScope;
  if (!expected || scopeKeys.some(k => typeof expected[k] !== 'string' || !expected[k].trim())) blockers.push('expected_scope_missing');
  const entries = Array.isArray(input?.artifacts) ? input.artifacts : [];
  for (const role of roles) {
    const matches = entries.filter(a => a?.role === role);
    if (matches.length !== 1) { blockers.push(`${role}_missing_or_duplicate`); continue; }
    const a = matches[0];
    if (!expected || scopeKeys.some(k => !expected[k] || a.scope?.[k] !== expected[k])) blockers.push(`${role}_scope_mismatch`);
    if (!/^[a-f0-9]{64}$/.test(a.sha256 ?? '') || typeof a.file !== 'string' || !a.file.trim()) { blockers.push(`${role}_file_evidence_missing`); continue; }
    try {
      const bytes = await readFile(path.resolve(baseDir, a.file));
      if (!bytes.length || createHash('sha256').update(bytes).digest('hex') !== a.sha256) blockers.push(`${role}_bytes_mismatch`);
    } catch { blockers.push(`${role}_file_unavailable`); }
    if (['digitalHuman', 'aigc'].includes(role)) {
      if (!a.provider?.name || !a.provider?.taskId || !a.provider?.rawReceiptRef) blockers.push(`${role}_provider_receipt_missing`);
      if (!a.cost || a.cost.currency !== 'CNY' || !Number.isFinite(a.cost.estimated) || a.cost.estimated < 0 || !Number.isFinite(a.cost.actual) || a.cost.actual < 0 || !a.cost.ledgerRef) blockers.push(`${role}_cost_evidence_missing`);
    }
    if (role === 'enterpriseMaterial' && !a.authorizationRef) blockers.push('enterprise_material_authorization_missing');
  }
  const final = entries.find(a => a?.role === 'finalVideo');
  if (final && (!Array.isArray(final.sourceSha256s) || entries.filter(a => ['voiceover','digitalHuman','aigc','enterpriseMaterial'].includes(a?.role)).some(a => !final.sourceSha256s.includes(a.sha256)))) blockers.push('final_source_binding_missing');
  if (input?.technicalReview?.status !== 'passed' || !input?.technicalReview?.reportRef) blockers.push('technical_review_missing');
  if (input?.creativeReview?.status !== 'passed' || !input?.creativeReview?.reviewerId || !input?.creativeReview?.reportRef) blockers.push('human_creative_review_missing');
  return {schemaVersion:'mvp-session-c-intake.v1', mode:'offline_intake', contractStatus:blockers.length ? 'blocked' : 'consistent', blockers, runtimeVerified:false, providerVerified:false, creativeAccepted:false, mvpPassed:false};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [inputFile, outputFile] = process.argv.slice(2);
  if (!inputFile || !outputFile) { console.error('Usage: node scripts/mvp-session-c-intake.mjs INPUT OUTPUT'); process.exitCode=2; }
  else {
    try {
      const result = await inspectSessionCIntake(JSON.parse(await readFile(inputFile,'utf8')),path.dirname(path.resolve(inputFile)));
      await writeFile(outputFile, JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
      console.log(JSON.stringify(result));
      if (result.contractStatus === 'blocked') process.exitCode=1;
    } catch { console.error('Intake failed: input unreadable/invalid or output already exists'); process.exitCode=2; }
  }
}
