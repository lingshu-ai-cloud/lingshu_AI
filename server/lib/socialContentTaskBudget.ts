import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { withPaidOperationLock } from './paidOperationLock.js';
export interface SocialTaskBudgetScope {
    tenantId: string;
    taskId: string;
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
    upperBoundCny: number;
    quoteRef: string;
    validUntil: string;
}
export interface SocialTaskBudgetAuthorization {
    maximumCny: number;
    authorizationRef: string;
}
/** These ports read canonical server records, never request-body claims. */
export interface SocialTaskBudgetPorts {
    authorization(scope: SocialTaskBudgetScope): Promise<SocialTaskBudgetAuthorization>;
    quote(scope: SocialTaskBudgetScope, operation: SocialTaskBudgetOperation): Promise<SocialTaskBudgetQuote>;
    assertCurrent(scope: SocialTaskBudgetScope): Promise<void>;
    verifyRejection(scope: SocialTaskBudgetScope, operation: SocialTaskBudgetOperation, receiptRef: string): Promise<boolean>;
}
export interface SocialTaskBudgetEntry extends SocialTaskBudgetOperation {
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
    entries: Record<string, SocialTaskBudgetEntry>;
}
function fail(code: string): never { throw Error(`social_task_budget_${code}`); }
const text = (s: string) => typeof s === 'string' && s.trim() === s && s.length > 0 && s.length <= 512;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const micros = (n: number) => { const m = Math.round(n * 1e6); if (!Number.isFinite(n) || n <= 0 || !Number.isSafeInteger(m) || m <= 0)
    fail('amount_invalid'); return m; };
function scopeCheck(s: SocialTaskBudgetScope) { if (![s.tenantId, s.taskId, s.runId].every(text) || !/^[a-f0-9]{64}$/.test(s.planHash))
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
    private file(s: SocialTaskBudgetScope) { return path.join(this.root, hash(JSON.stringify([s.tenantId, s.taskId])) + '.json'); }
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
        if (l.schemaVersion !== 1 || l.tenantId !== s.tenantId || l.taskId !== s.taskId || !Number.isSafeInteger(l.limitMicros) || l.limitMicros <= 0 || l.limitMicros > 10e6 || !Array.isArray(l.authorizationRefs) || !l.authorizationRefs.every(text) || !l.entries || typeof l.entries !== 'object' || Array.isArray(l.entries))
            fail('ledger_corrupt');
        for (const [id, e] of Object.entries(l.entries)) {
            operationCheck(e);
            if (id !== hash(e.operationId) || !text(e.runId) || !/^[a-f0-9]{64}$/.test(e.planHash) || !text(e.quoteRef) || !Number.isSafeInteger(e.reservedMicros) || e.reservedMicros <= 0 || !['reserved', 'accepted', 'unknown', 'completed', 'rejected'].includes(e.status) || (e.receiptRef !== null && !text(e.receiptRef)))
                fail('ledger_corrupt');
        }
        used(l);
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
    status(scope: SocialTaskBudgetScope) { scopeCheck(scope); const l = this.read(scope); return l ? { limitCny: l.limitMicros / 1e6, retainedCny: used(l) / 1e6, remainingCny: Math.max(0, l.limitMicros - used(l)) / 1e6, entries: structuredClone(Object.values(l.entries)) } : null; }
    async reserveBatch(scope: SocialTaskBudgetScope, operations: SocialTaskBudgetOperation[]) {
        scopeCheck(scope);
        if (!operations.length)
            fail('operations_empty');
        operations.forEach(operationCheck);
        if (new Set(operations.map(o => o.operationId)).size !== operations.length)
            fail('operation_duplicate');
        return withPaidOperationLock(path.join(this.root, '.locks'), JSON.stringify([scope.tenantId, scope.taskId]), async () => {
            await this.ports.assertCurrent(scope);
            const a = await this.ports.authorization(scope);
            if (!text(a.authorizationRef))
                fail('authorization_missing');
            const cap = Math.min(10e6, micros(a.maximumCny));
            const l = this.read(scope) || { schemaVersion: 1 as const, tenantId: scope.tenantId, taskId: scope.taskId, limitMicros: cap, authorizationRefs: [], entries: {} };
            l.limitMicros = Math.min(l.limitMicros, cap);
            if (!l.authorizationRefs.includes(a.authorizationRef))
                l.authorizationRefs.push(a.authorizationRef);
            for (const o of operations) {
                const id = hash(o.operationId), prior = l.entries[id];
                if (prior) {
                    if ((['operationId', 'fingerprint', 'provider', 'model', 'accountRef', 'stage', 'shotId'] as const).some(k => o[k] !== prior[k]) || prior.runId !== scope.runId || prior.planHash !== scope.planHash)
                        fail('operation_changed');
                    if (prior.status === 'rejected')
                        fail('rejected_requires_new_operation');
                    continue;
                }
                const q = await this.ports.quote(scope, o);
                if (!text(q.quoteRef) || !Number.isFinite(Date.parse(q.validUntil)) || Date.parse(q.validUntil) <= Date.now())
                    fail('quote_missing_or_expired');
                l.entries[id] = { ...o, runId: scope.runId, planHash: scope.planHash, quoteRef: q.quoteRef, reservedMicros: micros(q.upperBoundCny), status: 'reserved', receiptRef: null };
            }
            if (used(l) > l.limitMicros)
                fail('exceeded');
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
            if (e.status !== 'reserved' || !text(receiptRef) || !await this.ports.verifyRejection(scope, e, receiptRef)) fail('rejection_not_proven');
            e.status = 'rejected';
            e.receiptRef = receiptRef;
        });
    }
    private async mutate(scope: SocialTaskBudgetScope, id: string, fn: (e: SocialTaskBudgetEntry) => Promise<void>) {
        scopeCheck(scope);
        if (!text(id)) fail('operation_invalid');
        return withPaidOperationLock(path.join(this.root, '.locks'), JSON.stringify([scope.tenantId, scope.taskId]), async () => {
            await this.ports.assertCurrent(scope);
            const ledger = this.read(scope), entry = ledger?.entries[hash(id)];
            if (!ledger || !entry || entry.runId !== scope.runId || entry.planHash !== scope.planHash) fail('entry_scope_missing');
            await fn(entry);
            await this.ports.assertCurrent(scope);
            this.write(scope, ledger);
            return this.status(scope)!;
        });
    }
}
