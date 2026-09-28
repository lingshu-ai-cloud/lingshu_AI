/** Local readiness only; never an authorization or provider review receipt. */
export type AdPreflightCheck = { id: string; label: string; status: 'pass' | 'blocked' | 'warning'; message: string };
export type AdPreflightResult = { taskId: string; taskVersion: number; connectionId: string; action: string; scope: 'local'; checkedAt: string; canSubmit: boolean; checks: AdPreflightCheck[] };
