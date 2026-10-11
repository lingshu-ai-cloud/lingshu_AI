// Offline evidence freeze only. No environment loading, network or supplier submission.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relative = 'data/acceptance/local-backfill-20261009/project-before-local-fallback.json';
const bytes = fs.readFileSync(path.join(root, relative));
const project = JSON.parse(bytes);
const spec = typeof project.spec === 'string' ? JSON.parse(project.spec) : project.spec;
const script = 'How do you actually verify a skincare factory’s R&D, production, and QC capability—before committing to custom work?';
if (!spec.script?.includes(script)) throw new Error('Candidate narration changed or disappeared; do not freeze a substitute');
const reference = `data/media/tenants/${project.tenant_id}/reference-videos/trend_videos_192e76d4b21244c4a2922e60672c95f2.mp4`;
const sha = value => createHash('sha256').update(value).digest('hex');
const fileEvidence = file => {
  const full = path.join(root, file);
  return fs.existsSync(full) ? { path: file, bytes: fs.statSync(full).size, sha256: sha(fs.readFileSync(full)) } : { path: file, missing: true };
};
const ledgerFile = 'data/studio-paid-budget/ledger.json';
const ledger = JSON.parse(fs.readFileSync(path.join(root, ledgerFile)));
if (ledger.version !== 1 || !Number.isSafeInteger(ledger.limit) || !Number.isSafeInteger(ledger.openingUsed)) throw new Error('Unsupported budget ledger');
const entries = Object.values(ledger.entries);
if (entries.some(entry => !Number.isSafeInteger(entry.amount) || entry.amount <= 0)) throw new Error('Invalid budget reservation');
const reserved = entries.reduce((sum, entry) => sum + entry.amount, 0);
const providerEvidenceFile = 'docs/acceptance/mvp-session-a-provider-preflight.json';
const providerEvidence = fs.existsSync(path.join(root, providerEvidenceFile)) ? JSON.parse(fs.readFileSync(path.join(root, providerEvidenceFile), 'utf8')) : null;
// Read-only supplier observations do not satisfy business approval or rights checks.
const selectedLook = providerEvidence?.selectedLook || null;
const selectedVoice = providerEvidence?.selectedVoice || null;
const report = {
  schemaVersion: 1, state: 'blocked_before_paid_submission', paidSubmissionAuthorized: false,
  sourceRoot: root, freezeKind: 'candidate_snapshot_not_business_approval',
  lineage: { tenantId: project.tenant_id, projectId: project.id, workflowRunId: spec.workflowRunId, workflowTaskId: spec.workflowTaskId, accountId: spec.contentOrder?.accountId, accountLabel: spec.contentOrder?.accountLabel, productId: spec.contentOrder?.productId, zeroFoundationVerified: false },
  input: { script, scriptSha256: sha(script), sourceField: '$.spec.script first 台词 block', sourceRangeSeconds: [0, 11.33], ratio: '9:16', resolution: '720p', language: 'en', referenceUse: 'analysis_only_not_production', files: [fileEvidence(relative), fileEvidence(reference), fileEvidence('data/heygen-presenter-curation.json')] },
  callPlan: { provider: 'heygen', api: 'POST https://api.heygen.com/v3/videos', route: 'production /jobs', avatarLookId: selectedLook?.id || null, voiceId: selectedVoice?.id || null, providerEvidence: providerEvidence ? fileEvidence(providerEvidenceFile) : null, candidateGroup: { name: 'Zihan', groupId: 'e44a4228bd9649f5bdbe18ee5253d5ed' }, maxNewGenerations: 1, estimatedSeconds: [9, 12], requestId: `mvp-a-${sha(`${project.id}:${script}`).slice(0, 32)}`, requestIdStatus: 'draft_must_rederive_from_final_plan_and_presenter_version', actualCostCny: null, estimatedCostCny: null, priceVerified: false },
  budgetSnapshot: { source: fileEvidence(ledgerFile), kind: 'local_admission_reservations_not_supplier_invoice', limitCny: ledger.limit / 1e6, openingUsedCny: ledger.openingUsed / 1e6, reservedCny: reserved / 1e6, remainingCny: (ledger.limit - ledger.openingUsed - reserved) / 1e6, entries: entries.length, upstreamBalance: null },
  blockers: ['confirm_current_mvp_lineage_and_zero_foundation', 'resolve_account_product_identity_mismatch', 'confirm_script_and_storyboard_change', 'verify_exact_completed_portrait_look_and_english_voice', 'retain_provider_and_use_scoped_rights_evidence', 'verify_current_account_price_and_balance', 'reconcile_existing_budget_and_set_explicit_reserve_without_reset', 'obtain_specific_paid_call_approval'],
  evidenceRequiredAfterApproval: ['persist_current_plan_and_presenter_version', 'persist_request_and_budget_before_POST', 'retain_raw_supplier_video_id_and_status', 'retain_invoice_or_account_usage_delta', 'download_and_hash_actual_MP4', 'technical_audio_video_check_and_human_lip_sync_identity_review'],
  recovery: { knownTaskId: 'query original task only; no new POST or reservation', unknownWithoutTaskId: 'stop and reconcile original request with provider; no automatic retry', acceptedShot: 'reuse hash-verified result', orphanLock: 'retain until manual reconciliation' },
  acceptance: { controlledContractPassed: true, controlledTests: 33, realMediaGeneratedThisSession: false, realPaidSupplierCalledThisSession: false, creativeQualityPassed: false, realPublication: false, realPlatformReceipt: false, realMetricsRecovered: false, productionReadyTrue: false, productionReadinessObservedThisSession: false },
};
const output = path.join(root, 'docs/acceptance/mvp-session-a-input-freeze.json');
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output, state: report.state, files: report.input.files, budget: report.budgetSnapshot.remainingCny }));
