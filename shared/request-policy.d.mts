// Generated; edit request-policy.d.cts.
export interface HttpFailure { status: number; code: string; details: Record<string, unknown>; stale: boolean; message: string }
export function httpFailure(status: number, body: unknown, fallback?: string): HttpFailure;
export function decisionCommand<T extends string>(input: { actionId: T; expectedVersion: string; note?: string }): { actionId: T; expectedVersion: string; note?: string };
export function terminalReceipt(receipt: { status?: string } | null | undefined): boolean;
export function createRequestGuard(identity: () => string): { reset(): void; begin(): { current(): boolean; finish(): boolean } | null };
