import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveAccountHubDataDir } from './paths.js';

export interface AccountAuditEvent {
  actorId: string;
  action: string;
  target: string;
  status: number;
}

/** Append-only metadata audit. Request bodies and provider credentials are never recorded. */
export class AccountAuditLog {
  readonly dataDir: string;
  readonly file: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(dataDir = resolveAccountHubDataDir()) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'account-audit.jsonl');
  }

  record(event: AccountAuditEvent): Promise<void> {
    const entry = {
      id: `audit_${randomUUID()}`,
      at: new Date().toISOString(),
      actorId: String(event.actorId).slice(0, 200),
      action: String(event.action).slice(0, 32),
      target: String(event.target).slice(0, 500),
      status: event.status,
    };
    const run = this.queue.then(async () => {
      await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
      await fs.chmod(this.dataDir, 0o700);
      await fs.appendFile(this.file, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
      await fs.chmod(this.file, 0o600);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

let singleton: AccountAuditLog | undefined;

export function accountAuditLog(): AccountAuditLog {
  if (!singleton) singleton = new AccountAuditLog();
  return singleton;
}
