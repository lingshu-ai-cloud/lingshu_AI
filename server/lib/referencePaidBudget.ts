import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { withPaidOperationLock } from './paidOperationLock.js';
type Ledger = { version: 2; entries: Record<string, { tool: string; estimatedMicros: number; at: string; tenantId: string }> };
const micros = (value: number) => {
  const result = Math.round(value * 1e6);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error('参考人物任务缺少有效的预计费用，未调用供应商');
  return result;
};

/** Durable pre-submit usage ledger. It records forecast spend for reconciliation but never caps creation. */
export class ReferencePaidBudget {
  constructor(private readonly root: string, _legacyMonthlyLimitCny?: () => number) { void _legacyMonthlyLimitCny; }
  async reserve(tool: string, operationId: string, estimatedCostCny: number | null, tenantId?: string) {
    return withPaidOperationLock(path.join(this.root, '.locks'), 'budget', async () => {
      const estimatedMicros = micros(Number(estimatedCostCny));
      const file = path.join(this.root, 'usage-ledger.json');
      const ledger: Ledger = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 2, entries: {} };
      if (ledger.version !== 2 || !ledger.entries || typeof ledger.entries !== 'object' || Array.isArray(ledger.entries)
        || Object.values(ledger.entries).some(item => !item || !Number.isSafeInteger(item.estimatedMicros) || item.estimatedMicros <= 0)) {
        throw new Error('参考人物费用计量账本异常，请管理员核账；未调用供应商');
      }
      const id = createHash('sha256').update(`${tool}:${operationId}`).digest('hex');
      if (ledger.entries[id]) return;
      ledger.entries[id] = { tool, estimatedMicros, at: new Date().toISOString(), tenantId: String(tenantId || '') };
      fs.mkdirSync(this.root, { recursive: true }); const temporary = path.join(this.root, `usage-ledger.${randomUUID()}.tmp`);
      fs.writeFileSync(temporary, JSON.stringify(ledger), { mode: 0o600 }); fs.renameSync(temporary, file);
    });
  }
  async release(tool: string, operationId: string, tenantId?: string) {
    void tenantId;
    return withPaidOperationLock(path.join(this.root, '.locks'), 'budget', async () => {
      const file = path.join(this.root, 'usage-ledger.json');
      if (!fs.existsSync(file)) return;
      const ledger = JSON.parse(fs.readFileSync(file, 'utf8')) as Ledger;
      if (ledger.version !== 2 || !ledger.entries || typeof ledger.entries !== 'object' || Array.isArray(ledger.entries)
        || Object.values(ledger.entries).some(item => !item || !Number.isSafeInteger(item.estimatedMicros) || item.estimatedMicros <= 0)) {
        throw new Error('参考人物费用计量账本异常，无法清理明确未提交的计量记录');
      }
      const id = createHash('sha256').update(`${tool}:${operationId}`).digest('hex');
      if (!ledger.entries[id]) return;
      delete ledger.entries[id];
      const temporary = path.join(this.root, `usage-ledger.${randomUUID()}.tmp`);
      fs.writeFileSync(temporary, JSON.stringify(ledger), { mode: 0o600 }); fs.renameSync(temporary, file);
    });
  }
}

export const referencePaidBudget = new ReferencePaidBudget(path.resolve(process.cwd(), 'data/studio-reference-budget'));
