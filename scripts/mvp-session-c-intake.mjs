import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {socialRequestHash} from '../server/starter198/socialContentValidation.ts';
import {assertSocialMvpExecutionPackage, assertSocialMvpClipHandoff, assertSocialMvpClipBatch, SOCIAL_MVP_SCOPE_KEYS} from '../shared/contracts/socialMvpHandoff.ts';

const scopeKeys = SOCIAL_MVP_SCOPE_KEYS;
const roles = ['reference', 'script', 'storyboard', 'voiceover', 'digitalHuman', 'aigc', 'enterpriseMaterial', 'finalVideo'];
// This offline intake detects missing or conflicting handoff evidence. Editable
// JSON and byte hashes cannot certify provider origin or creative acceptance.
export async function inspectSessionCIntake(input, baseDir = process.cwd()) {
  const blockers = [];
  const expected = input?.expectedScope;
  if (!expected || scopeKeys.some(k => typeof expected[k] !== 'string' || !expected[k].trim())) blockers.push('expected_scope_missing');
  // The business owner resolves identity conflicts before any clip intake.
  // Even an executable offline audit remains a claim, never authority proof.
  try {
    const auditRef = input?.businessIdentityAudit;
    if (!auditRef || typeof auditRef.file !== 'string' || !/^[a-f0-9]{64}$/.test(auditRef.sha256 ?? '')) throw Error();
    const bytes = await readFile(path.resolve(baseDir, auditRef.file));
    if (createHash('sha256').update(bytes).digest('hex') !== auditRef.sha256) throw Error();
    const audit = JSON.parse(bytes.toString('utf8'));
    if (audit.executable !== true || !audit.uniqueExecutableCandidate || !expected
      || scopeKeys.some(k => audit.uniqueExecutableCandidate[k] !== expected[k])) blockers.push('business_identity_unresolved');
  } catch { blockers.push('business_identity_audit_missing_or_changed'); }
  let packageValid = false;
  try {
    assertSocialMvpExecutionPackage(input?.executionPackage);
    const {recordHash, ...packageBody} = input.executionPackage;
    if (socialRequestHash(packageBody) !== recordHash) blockers.push('execution_package_bytes_mismatch');
    if (!expected || scopeKeys.some(k => input.executionPackage.scope[k] !== expected[k])) blockers.push('execution_package_scope_mismatch');
    else packageValid = true;
  } catch { blockers.push('unified_execution_package_missing_or_invalid'); }
  const clips = Array.isArray(input?.clips) ? input.clips : [];
  const sceneIds = new Set();
  if (packageValid) {
    for (const clip of clips) {
      try {
        assertSocialMvpClipHandoff(clip, input.executionPackage);
        if (sceneIds.has(clip.sceneId)) blockers.push('duplicate_scene_handoff');
        sceneIds.add(clip.sceneId);
        const bytes = await readFile(path.resolve(baseDir, clip.file.path));
        if (!bytes.length || createHash('sha256').update(bytes).digest('hex') !== clip.file.sha256) blockers.push('clip_bytes_mismatch');
      } catch { blockers.push('clip_handoff_invalid_or_unavailable'); }
    }
    try { assertSocialMvpClipBatch(input.executionPackage, clips, input.historicalBudgetSpent); }
    catch { blockers.push('batch_or_historical_budget_unverified'); }
    for (const scene of input.executionPackage.scenes) {
      if (['digital_human','key_aigc'].includes(scene.role) && !sceneIds.has(scene.sceneId)) blockers.push('required_scene_handoff_missing');
    }
  }
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
  if (final && clips.some(c => !final.sourceSha256s?.includes(c.file?.sha256))) blockers.push('final_clip_binding_missing');
  if (packageValid && entries.some(a => ['digitalHuman','aigc'].includes(a?.role) && !clips.some(c => c?.lane === (a.role === 'digitalHuman' ? 'A' : 'B') && c.file?.sha256 === a.sha256))) blockers.push('artifact_clip_binding_missing');
  if (input?.technicalReview?.status !== 'passed' || !input?.technicalReview?.reportRef) blockers.push('technical_review_missing');
  if (input?.creativeReview?.status !== 'passed' || !input?.creativeReview?.reviewerId || !input?.creativeReview?.reportRef) blockers.push('human_creative_review_missing');
  for (const review of [input?.technicalReview, input?.creativeReview]) {
    if (!expected || scopeKeys.some(k => review?.scope?.[k] !== expected[k]) || review?.packageHash !== input?.executionPackage?.recordHash || !final || review?.fileSha256 !== final.sha256) blockers.push('review_scope_or_media_binding_missing');
  }
  return {schemaVersion:'mvp-session-c-intake.v2', mode:'offline_intake', contractStatus:blockers.length ? 'blocked' : 'consistent', blockers, runtimeVerified:false, providerVerified:false, creativeAccepted:false, mvpPassed:false};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [inputFile, outputFile] = process.argv.slice(2);
  if (!inputFile || !outputFile) { console.error('Usage: tsx scripts/mvp-session-c-intake.mjs INPUT OUTPUT'); process.exitCode=2; }
  else {
    try {
      const result = await inspectSessionCIntake(JSON.parse(await readFile(inputFile,'utf8')),path.dirname(path.resolve(inputFile)));
      await writeFile(outputFile, JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
      console.log(JSON.stringify(result));
      if (result.contractStatus === 'blocked') process.exitCode=1;
    } catch { console.error('Intake failed: input unreadable/invalid or output already exists'); process.exitCode=2; }
  }
}
