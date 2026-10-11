import type { Server } from 'node:http';

type ShutdownTimer = ReturnType<typeof setTimeout>;

export interface GracefulShutdownOptions {
  server: Pick<Server, 'close'> & Partial<Pick<Server, 'closeIdleConnections' | 'closeAllConnections'>>;
  stop: Array<() => void>;
  deadlineMs?: number;
  exit?: (code: number) => never | void;
  scheduleDeadline?: (callback: () => void, delayMs: number) => ShutdownTimer;
  clearDeadline?: (timer: ShutdownTimer) => void;
  log?: Pick<Console, 'log' | 'error'>;
}

/**
 * Stop accepting work, drain HTTP, then terminate the process even when a
 * third-party/background-worker timer still holds the event loop open.
 */
export function createGracefulShutdown(options: GracefulShutdownOptions): (signal: string) => void {
  const deadlineMs = options.deadlineMs ?? 30_000;
  const exit = options.exit ?? (code => process.exit(code));
  const scheduleDeadline = options.scheduleDeadline ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearDeadline = options.clearDeadline ?? clearTimeout;
  const log = options.log ?? console;
  let shuttingDown = false;

  return (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    let cleanupFailed = false;
    for (const stop of options.stop) {
      try {
        stop();
      } catch (error) {
        cleanupFailed = true;
        log.error('[runtime] shutdown cleanup failed:', error);
      }
    }

    log.log(`[runtime] ${signal} received; draining HTTP connections`);
    const deadline = scheduleDeadline(() => {
      log.error('[runtime] graceful shutdown deadline exceeded');
      options.server.closeAllConnections?.();
      exit(1);
    }, deadlineMs);
    deadline.unref?.();

    options.server.close(error => {
      clearDeadline(deadline);
      if (error) log.error('[runtime] graceful shutdown failed:', error);
      exit(error || cleanupFailed ? 1 : 0);
    });
    options.server.closeIdleConnections?.();
  };
}
