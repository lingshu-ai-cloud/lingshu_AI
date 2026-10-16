import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { withPaidOperationLock } from './paidOperationLock.js';
import { isInternalBudgetExemptTenant } from './tenantBudgetExemption.js';
export interface SocialTaskBudgetScope {
    tenantId: string;
    taskId: string;
    /** Canonical original-content ledger identity, resolved from server lineage.
     * taskId remains the actual execution identity used by permits. */
    budgetTaskId?: string;
    runId: string;
    planHash: string;
}
export interface SocialTaskBudgetOperation {
    operationId: string;
    fingerprint: string;
    provider: string;
    model: string;
    accountRef: string;
    stage: string;
    shotId: string | null;
}
export interface SocialTaskBudgetQuote {
    /** Original currency is retained; the CNY allocation is a planning estimate. */
    nativePricing?: { basis: 'published_fx_estimate'; currency: 'USD'; usdPerMinute: number; maximumProviderSeconds: number; estimatedCnyPerUsd: number; fxDate: string; pricingSourceSha256: string; fxSourceSha256: string };
    upperBoundCny: number;
    quoteRef: string;
    validUntil: string;
}
export interface SocialTaskBudgetAuthorization {
    maximumCny: number;
    maximumExecutionCny?:number;
    authorizationRef: string;
}
export interface SocialTaskCorrectionBudgetAuthorization {
    schemaVersion: 1;
    tenantId: string;
    taskId: string;
    runId: string;
    planHash: string;
    previousMaximumCny: number;
    maximumCny: number;
    reason: 'provider_correction';
    correctionCause: 'approved_first_frame_not_consumed'|'approved_first_frame_not_consumed_and_bound_voice_mismatch';
    affectedPresenterGroupIds: [string, string, string];
    presenterApprovalBindings: [{groupId:string;approvalRecordHash:string},{groupId:string;approvalRecordHash:string},{groupId:string;approvalRecordHash:string}];
    selectedVoiceId?:string;
    selectedVoiceFingerprint?:string;
    supersedes?:{recordHash:string;authorizationRef:string};
    authorizedBy: string;
    authorizationRef: string;
    issuedAt: string;
    recordHash: string;
}
/** These ports read canonical server records, never request-body claims. */
export interface SocialTaskBudgetPorts {
    authorization(scope: SocialTaskBudgetScope): Promise<SocialTaskBudgetAuthorization>;
    quote(scope: SocialTaskBudgetScope, operation: SocialTaskBudgetOperation): Promise<SocialTaskBudgetQuote>;
    assertCurrent(scope: SocialTaskBudgetScope): Promise<void>;
    verifyRejection(scope: SocialTaskBudgetScope, operation: SocialTaskBudgetOperation, receiptRef: string): Promise<boolean>;
}
export interface SocialTaskBudgetEntry extends SocialTaskBudgetOperation {
    executionTaskId?: string;
    runId: string;
    planHash: string;
    quoteRef: string;
    reservedMicros: number;
    status: 'reserved' | 'accepted' | 'unknown' | 'completed' | 'rejected';
    receiptRef: string | null;
}
interface Ledger {
    schemaVersion: 1;
    tenantId: string;
    taskId: string;
    limitMicros: number;
    authorizationRefs: string[];
    executionLimitMicros?:Record<string,number>;
    correctionAuthorization?: SocialTaskCorrectionBudgetAuthorization;
    correctionAuthorizationHistory?: SocialTaskCorrectionBudgetAuthorization[];
    entries: Record<string, SocialTaskBudgetEntry>;
}
function fail(code: string): never { throw Error(`social_task_budget_${code}`); }
const text = (s: string) => typeof s === 'string' && s.trim() === s && s.length > 0 && s.length <= 512;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const correctionHash = (value: Omit<SocialTaskCorrectionBudgetAuthorization, 'recordHash'>) => hash(JSON.stringify(value));
export function sealSocialTaskCorrectionBudgetAuthorization(value: Omit<SocialTaskCorrectionBudgetAuthorization, 'recordHash'>): SocialTaskCorrectionBudgetAuthorization {
    return { ...value, recordHash: correctionHash(value) };
}
const micros = (n: number) => { const m = Math.round(n * 1e6); if (!Number.isFinite(n) || n <= 0 || !Number.isSafeInteger(m) || m <= 0)
    fail('amount_invalid'); return m; };
function scopeCheck(s: SocialTaskBudgetScope) { if (![s.tenantId, s.taskId, s.runId].every(text) || s.budgetTaskId!==undefined&&!text(s.budgetTaskId) || !/^[a-f0-9]{64}$/.test(s.planHash))
    fail('scope_invalid'); }
function operationCheck(o: SocialTaskBudgetOperation) { if (![o.operationId, o.provider, o.model, o.accountRef, o.stage].every(text) || !/^[a-f0-9]{64}$/.test(o.fingerprint) || (o.shotId !== null && !text(o.shotId)))
    fail('operation_invalid'); }
function used(l: Ledger) { const n = Object.values(l.entries).reduce((v, e) => v + (e.status === 'rejected' ? 0 : e.reservedMicros), 0); if (!Number.isSafeInteger(n))
    fail('ledger_corrupt'); return n; }
/** A task, including replacement runs and retries, owns ONE ceiling. All paid stages
 * must reserve here before provider submission. Unknown billing retains the upper
 * bound. This is a shared-volume ledger; crashed locks require reconciliation. */
export class SocialContentTaskBudget {
    constructor(private readonly root = path.resolve(process.env.SOCIAL_CONTENT_TASK_BUDGET_DIR || 'data/social-content-task-budget'), private readonly ports: SocialTaskBudgetPorts) { }
    private file(s: SocialTaskBudgetScope) { return path.join(this.root, hash(JSON.stringify([s.tenantId, s.budgetTaskId??s.taskId])) + '.json'); }
    private read(s: SocialTaskBudgetScope): Ledger | null {
        const f = this.file(s);
        if (!fs.existsSync(f))
            return null;
        let l: Ledger;
        try {
            l = JSON.parse(fs.readFileSync(f, 'utf8'));
        }
        catch {
            return fail('ledger_corrupt');
        }
        if (l.schemaVersion !== 1 || l.tenantId !== s.tenantId || l.taskId !== (s.budgetTaskId??s.taskId) || !Number.isSafeInteger(l.limitMicros) || l.limitMicros <= 0 || l.limitMicros > 20e6 || !Array.isArray(l.authorizationRefs) || !l.authorizationRefs.every(text) || !l.entries || typeof l.entries !== 'object' || Array.isArray(l.entries))
            fail('ledger_corrupt');
        if (l.correctionAuthorization || l.limitMicros > 15e6) {
            const grant = l.correctionAuthorization;
            if (!grant) fail('ledger_corrupt');
            const { recordHash, ...body } = grant;
            if (grant.schemaVersion !== 1 || grant.tenantId !== l.tenantId || grant.taskId !== l.taskId
                || !text(grant.runId) || !/^[a-f0-9]{64}$/.test(grant.planHash)
                || grant.reason !== 'provider_correction' || !['approved_first_frame_not_consumed','approved_first_frame_not_consumed_and_bound_voice_mismatch'].includes(grant.correctionCause)
                || !Array.isArray(grant.affectedPresenterGroupIds) || grant.affectedPresenterGroupIds.length !== 3
                || new Set(grant.affectedPresenterGroupIds).size !== 3 || !grant.affectedPresenterGroupIds.every(text)
                || !Array.isArray(grant.presenterApprovalBindings) || grant.presenterApprovalBindings.length !== 3
                || grant.presenterApprovalBindings.some(item=>!item||!text(item.groupId)||!/^[a-f0-9]{64}$/.test(item.approvalRecordHash))
                || JSON.stringify(grant.presenterApprovalBindings.map(item=>item.groupId).sort())!==JSON.stringify([...grant.affectedPresenterGroupIds].sort())
                || !text(grant.authorizedBy) || !text(grant.authorizationRef)
                || !Number.isFinite(Date.parse(grant.issuedAt)) || grant.previousMaximumCny !== 10
                || (grant.correctionCause==='approved_first_frame_not_consumed_and_bound_voice_mismatch'&&(!text(grant.selectedVoiceId!)||!/^[a-f0-9]{64}$/.test(grant.selectedVoiceFingerprint!)||!grant.supersedes||!/^[a-f0-9]{64}$/.test(grant.supersedes.recordHash)||!text(grant.supersedes.authorizationRef)))
                || micros(grant.maximumCny) !== l.limitMicros || grant.maximumCny > (grant.correctionCause==='approved_first_frame_not_consumed'?16.5:20)
                || recordHash !== correctionHash(body)) fail('ledger_corrupt');
            if(grant.correctionCause==='approved_first_frame_not_consumed_and_bound_voice_mismatch'){
                const history=l.correctionAuthorizationHistory;
                if(!Array.isArray(history)||history.length!==1||history[0]?.recordHash!==grant.supersedes?.recordHash||history[0]?.authorizationRef!==grant.supersedes.authorizationRef)fail('ledger_corrupt');
            }
        }
        for (const [id, e] of Object.entries(l.entries)) {
            operationCheck(e);
            if(e.executionTaskId!==undefined&&!text(e.executionTaskId))fail('ledger_corrupt');
            if (id !== hash(e.operationId) || !text(e.runId) || !/^[a-f0-9]{64}$/.test(e.planHash) || !text(e.quoteRef) || !Number.isSafeInteger(e.reservedMicros) || e.reservedMicros <= 0 || !['reserved', 'accepted', 'unknown', 'completed', 'rejected'].includes(e.status) || (e.receiptRef !== null && !text(e.receiptRef)))
                fail('ledger_corrupt');
        }
        used(l);
        if(l.executionLimitMicros&&Object.entries(l.executionLimitMicros).some(([id,limit])=>!text(id)||!Number.isSafeInteger(limit)||limit<0))fail('ledger_corrupt');
        return l;
    }
    private write(s: SocialTaskBudgetScope, l: Ledger) { fs.mkdirSync(this.root, { recursive: true, mode: 0o700 }); const f = this.file(s), temp = f + '.' + randomUUID() + '.tmp'; try {
        const fd = fs.openSync(temp, 'wx', 0o600);
        try {
            fs.writeFileSync(fd, JSON.stringify(l));
            fs.fsyncSync(fd);
        }
        finally {
            fs.closeSync(fd);
        }
        fs.renameSync(temp, f);
        const directory = fs.openSync(this.root, 'r');
        try {
            fs.fsyncSync(directory);
        }
        finally {
            fs.closeSync(directory);
        }
    }
    finally {
        if (fs.existsSync(temp))
            fs.unlinkSync(temp);
    } }
    status(scope: SocialTaskBudgetScope) { scopeCheck(scope); const l = this.read(scope); if (!l) return null; const retainedMicros=used(l), correction=l.correctionAuthorization, correctionMatches=correction?.runId===scope.runId&&correction.planHash===scope.planHash; const limitMicros=correctionMatches?l.limitMicros:Math.min(l.limitMicros,correction?10e6:15e6); return { limitCny: limitMicros / 1e6, retainedCny: retainedMicros / 1e6, remainingCny: Math.max(0, limitMicros - retainedMicros) / 1e6, correctionAuthorization: correctionMatches ? structuredClone(correction) : null, entries: structuredClone(Object.values(l.entries)) }; }
    /** Applies a server-authored, scope-bound correction grant. This is not
     * exposed as a client budget setter: it may only extend an existing ¥10
     * ledger for the exact run and plan that incurred the defective spend. */
    async authorizeCorrection(scope: SocialTaskBudgetScope, grant: SocialTaskCorrectionBudgetAuthorization) {
        scopeCheck(scope);
        // Existing correction grants bind the original task, run and plan.
        // A child revision cannot rewrite that historical financial authority.
        if(scope.budgetTaskId&&scope.budgetTaskId!==scope.taskId)fail('correction_original_task_required');
        return withPaidOperationLock(path.join(this.root, '.locks'), JSON.stringify([scope.tenantId, scope.budgetTaskId??scope.taskId]), async () => {
            await this.ports.assertCurrent(scope);
            const ledger = this.read(scope);
            const { recordHash, ...body } = grant;
            if (grant.schemaVersion !== 1 || grant.tenantId !== scope.tenantId || grant.taskId !== scope.taskId
                || grant.runId !== scope.runId || grant.planHash !== scope.planHash
                || grant.previousMaximumCny !== 10 || grant.reason !== 'provider_correction'
                || !['approved_first_frame_not_consumed','approved_first_frame_not_consumed_and_bound_voice_mismatch'].includes(grant.correctionCause)
                || !Array.isArray(grant.affectedPresenterGroupIds) || grant.affectedPresenterGroupIds.length !== 3
                || new Set(grant.affectedPresenterGroupIds).size !== 3 || !grant.affectedPresenterGroupIds.every(text)
                || !Array.isArray(grant.presenterApprovalBindings) || grant.presenterApprovalBindings.length !== 3
                || grant.presenterApprovalBindings.some(item=>!item||!text(item.groupId)||!/^[a-f0-9]{64}$/.test(item.approvalRecordHash))
                || JSON.stringify(grant.presenterApprovalBindings.map(item=>item.groupId).sort())!==JSON.stringify([...grant.affectedPresenterGroupIds].sort())
                || !text(grant.authorizedBy) || !text(grant.authorizationRef)
                || !Number.isFinite(Date.parse(grant.issuedAt)) || Date.parse(grant.issuedAt) > Date.now() + 60_000
                || (grant.correctionCause==='approved_first_frame_not_consumed_and_bound_voice_mismatch'&&(!text(grant.selectedVoiceId!)||!/^[a-f0-9]{64}$/.test(grant.selectedVoiceFingerprint!)||!grant.supersedes||!/^[a-f0-9]{64}$/.test(grant.supersedes.recordHash)||!text(grant.supersedes.authorizationRef)))
                || !Number.isFinite(grant.maximumCny) || grant.maximumCny <= 10 || grant.maximumCny > (grant.correctionCause==='approved_first_frame_not_consumed'?16.5:20)
                || recordHash !== correctionHash(body)) fail('correction_authorization_invalid');
            if (!ledger) fail('correction_original_budget_missing');
            if (ledger.correctionAuthorization) {
                const prior=ledger.correctionAuthorization;
                if (prior.recordHash === grant.recordHash) return this.status(scope)!;
                if(grant.correctionCause!=='approved_first_frame_not_consumed_and_bound_voice_mismatch'||prior.correctionCause!=='approved_first_frame_not_consumed'
                    ||grant.maximumCny!==20||grant.supersedes?.recordHash!==prior.recordHash||grant.supersedes.authorizationRef!==prior.authorizationRef
                    ||JSON.stringify(grant.affectedPresenterGroupIds)!==JSON.stringify(prior.affectedPresenterGroupIds)
                    ||JSON.stringify(grant.presenterApprovalBindings)!==JSON.stringify(prior.presenterApprovalBindings))fail('correction_authorization_conflict');
                ledger.limitMicros=micros(grant.maximumCny);ledger.correctionAuthorizationHistory=[structuredClone(prior)];ledger.correctionAuthorization=structuredClone(grant);
                if(!ledger.authorizationRefs.includes(grant.authorizationRef))ledger.authorizationRefs.push(grant.authorizationRef);
                await this.ports.assertCurrent(scope);this.write(scope,ledger);return this.status(scope)!;
            }
            if (ledger.limitMicros !== 10e6) fail('correction_original_budget_missing');
            ledger.limitMicros = micros(grant.maximumCny);
            ledger.correctionAuthorization = structuredClone(grant);
            if (!ledger.authorizationRefs.includes(grant.authorizationRef)) ledger.authorizationRefs.push(grant.authorizationRef);
            await this.ports.assertCurrent(scope);
            this.write(scope, ledger);
            return this.status(scope)!;
        });
    }
    async reserveBatch(scope: SocialTaskBudgetScope, operations: SocialTaskBudgetOperation[]) {
        scopeCheck(scope);
        if (!operations.length)
            fail('operations_empty');
        operations.forEach(operationCheck);
        if (new Set(operations.map(o => o.operationId)).size !== operations.length)
            fail('operation_duplicate');
        return withPaidOperationLock(path.join(this.root, '.locks'), JSON.stringify([scope.tenantId, scope.budgetTaskId??scope.taskId]), async () => {
            await this.ports.assertCurrent(scope);
            const a = await this.ports.authorization(scope);
            if (!text(a.authorizationRef))
                fail('authorization_missing');
            const baseCap = Math.min(15e6, micros(a.maximumCny));
            const l = this.read(scope) || { schemaVersion: 1 as const, tenantId: scope.tenantId, taskId: scope.budgetTaskId??scope.taskId, limitMicros: baseCap, authorizationRefs: [], entries: {} };
            if(a.maximumExecutionCny!==undefined){
              if(!Number.isFinite(a.maximumExecutionCny)||a.maximumExecutionCny<0)return fail('execution_allowance_invalid');
              const ceiling=Math.round(a.maximumExecutionCny*1e6);if(!Number.isSafeInteger(ceiling))return fail('execution_allowance_invalid');
              const limits=(l.executionLimitMicros??={}),key=hash(scope.taskId);
              limits[key]=Math.min(limits[key]??ceiling,ceiling);
            }
            const correction = l.correctionAuthorization;
            const correctionMatches = correction?.tenantId === scope.tenantId && correction.taskId === scope.taskId
                && correction.runId === scope.runId && correction.planHash === scope.planHash;
            const cap = correctionMatches ? l.limitMicros : baseCap;
            if (!correctionMatches) l.limitMicros = Math.min(l.limitMicros, baseCap);
            if (!l.authorizationRefs.includes(a.authorizationRef))
                l.authorizationRefs.push(a.authorizationRef);
            for (const o of operations) {
                const id = hash(o.operationId), prior = l.entries[id];
                if (prior) {
                    if ((prior.executionTaskId??l.taskId)!==scope.taskId || (['operationId', 'fingerprint', 'provider', 'model', 'accountRef', 'stage', 'shotId'] as const).some(k => o[k] !== prior[k]) || prior.runId !== scope.runId || prior.planHash !== scope.planHash)
                        fail('operation_changed');
                    if (prior.status === 'rejected')
                        fail('rejected_requires_new_operation');
                    continue;
                }
                const q = await this.ports.quote(scope, o);
                if (!text(q.quoteRef) || !Number.isFinite(Date.parse(q.validUntil)) || Date.parse(q.validUntil) <= Date.now())
                    fail('quote_missing_or_expired');
                l.entries[id] = { ...o, executionTaskId:scope.taskId, runId: scope.runId, planHash: scope.planHash, quoteRef: q.quoteRef, reservedMicros: micros(q.upperBoundCny), status: 'reserved', receiptRef: null };
            }
            if (!isInternalBudgetExemptTenant(scope.tenantId) && used(l) > l.limitMicros)
                fail('exceeded');
            const executionLimit=l.executionLimitMicros?.[hash(scope.taskId)];
            if(executionLimit!==undefined&&Object.values(l.entries).filter(e=>(e.executionTaskId??l.taskId)===scope.taskId&&e.status!=='rejected').reduce((sum,e)=>sum+e.reservedMicros,0)>executionLimit)fail('execution_allowance_exceeded');
            await this.ports.assertCurrent(scope);
            this.write(scope, l);
            return this.status(scope)!;
        });
    }
    async markOutcome(scope: SocialTaskBudgetScope, operationId: string, status: 'accepted' | 'unknown' | 'completed', receiptRef: string) {
        return this.mutate(scope, operationId, async e => {
            if (!text(receiptRef)) fail('receipt_missing');
            if (e.status === 'rejected' || (e.status === 'completed' && status !== 'completed')) fail('outcome_conflict');
            if (e.status === 'completed' && e.receiptRef !== receiptRef) fail('receipt_changed');
            e.status = status;
            e.receiptRef = receiptRef;
        });
    }
    async releaseRejected(scope: SocialTaskBudgetScope, operationId: string, receiptRef: string) {
        return this.mutate(scope, operationId, async e => {
            if (!['reserved','unknown'].includes(e.status) || !text(receiptRef) || !await this.ports.verifyRejection(scope, e, receiptRef)) fail('rejection_not_proven');
            e.status = 'rejected';
            e.receiptRef = receiptRef;
        });
    }
    private async mutate(scope: SocialTaskBudgetScope, id: string, fn: (e: SocialTaskBudgetEntry) => Promise<void>) {
        scopeCheck(scope);
        if (!text(id)) fail('operation_invalid');
        return withPaidOperationLock(path.join(this.root, '.locks'), JSON.stringify([scope.tenantId, scope.budgetTaskId??scope.taskId]), async () => {
            await this.ports.assertCurrent(scope);
            const ledger = this.read(scope), entry = ledger?.entries[hash(id)];
            if (!ledger || !entry || (entry.executionTaskId??ledger.taskId)!==scope.taskId || entry.runId !== scope.runId || entry.planHash !== scope.planHash) fail('entry_scope_missing');
            await fn(entry);
            await this.ports.assertCurrent(scope);
            this.write(scope, ledger);
            return this.status(scope)!;
        });
    }
}
