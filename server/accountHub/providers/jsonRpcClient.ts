import { redactText, redactValue } from './redaction.js';
import type { SafeProcessRunnerLike, SafeRunningProcess } from './safeProcess.js';
import { AccountProviderError } from './types.js';

interface RpcResponse {
  id?: number | string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
  method?: string;
  params?: unknown;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface NotificationWaiter {
  reject(error: Error): void;
  timer: NodeJS.Timeout;
  method: string;
  listener: NotificationListener;
}

type NotificationListener = (params: unknown) => void;

export class JsonRpcProcessClient {
  private nextId = 1;
  private readonly pending = new Map<number | string, PendingRequest>();
  private readonly notificationListeners = new Map<string, Set<NotificationListener>>();
  private readonly notificationHistory = new Map<string, unknown[]>();
  private readonly notificationWaiters = new Set<NotificationWaiter>();
  private readonly process: SafeRunningProcess;
  private closed = false;

  private constructor(options: {
    runner: SafeProcessRunnerLike;
    command: string;
    args: readonly string[];
    cwd?: string;
    env: Readonly<Record<string, string>>;
    signal?: AbortSignal;
    lifetimeMs: number;
  }) {
    this.process = options.runner.start({
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      env: options.env,
      timeoutMs: options.lifetimeMs,
      signal: options.signal,
      onStdoutLine: (line) => this.receive(line),
    });
    void this.process.result.then((result) => {
      this.closed = true;
      const message = result.reason === 'spawn_error'
        ? result.error ?? 'CLI executable not found'
        : result.reason === 'timeout'
          ? 'CLI protocol session timed out'
          : result.reason === 'cancelled'
            ? 'CLI protocol session cancelled'
            : result.stderr || `CLI protocol session exited (${result.code ?? 'unknown'})`;
      const code = result.reason === 'timeout'
        ? 'timeout'
        : result.reason === 'cancelled'
          ? 'cancelled'
          : result.reason === 'spawn_error'
            ? 'cli_unavailable'
            : 'protocol_error';
      this.rejectAll(new AccountProviderError(code, redactText(message)));
    });
  }

  static async connect(options: {
    runner: SafeProcessRunnerLike;
    command: string;
    args: readonly string[];
    cwd?: string;
    env: Readonly<Record<string, string>>;
    signal?: AbortSignal;
    lifetimeMs?: number;
    initializeTimeoutMs?: number;
    clientName?: string;
  }): Promise<JsonRpcProcessClient> {
    const client = new JsonRpcProcessClient({
      ...options,
      lifetimeMs: options.lifetimeMs ?? 30_000,
    });
    await client.request('initialize', {
      clientInfo: {
        name: options.clientName ?? 'lingshu_account_hub',
        title: 'Lingshu Account Hub',
        version: '0.1.0',
      },
    }, options.initializeTimeoutMs ?? 10_000);
    client.notify('initialized', {});
    return client;
  }

  request(method: string, params?: unknown, timeoutMs = 15_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new AccountProviderError('protocol_error', 'CLI protocol session is closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AccountProviderError('timeout', `${method} timed out`));
      }, Math.max(1, timeoutMs));
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.process.writeLine({ method, id, params: params ?? {} });
    });
  }

  notify(method: string, params?: unknown): void {
    if (!this.closed) this.process.writeLine({ method, params: params ?? {} });
  }

  waitForNotification(
    method: string,
    predicate: (params: unknown) => boolean = () => true,
    timeoutMs = 600_000,
  ): Promise<unknown> {
    for (const item of this.notificationHistory.get(method) ?? []) {
      if (predicate(item)) return Promise.resolve(item);
    }

    return new Promise((resolve, reject) => {
      let waiter: NotificationWaiter;
      const listener: NotificationListener = (params) => {
        if (!predicate(params)) return;
        clearTimeout(timer);
        this.notificationListeners.get(method)?.delete(listener);
        this.notificationWaiters.delete(waiter);
        resolve(params);
      };
      const timer = setTimeout(() => {
        this.notificationListeners.get(method)?.delete(listener);
        this.notificationWaiters.delete(waiter);
        reject(new AccountProviderError('timeout', `${method} notification timed out`));
      }, Math.max(1, timeoutMs));
      timer.unref?.();
      waiter = { reject, timer, method, listener };
      this.notificationWaiters.add(waiter);
      const listeners = this.notificationListeners.get(method) ?? new Set();
      listeners.add(listener);
      this.notificationListeners.set(method, listeners);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.process.cancel('CLI protocol session finished');
    this.rejectAll(new AccountProviderError('cancelled', 'CLI protocol session finished'));
  }

  private receive(line: string): void {
    let message: RpcResponse;
    try {
      message = JSON.parse(line) as RpcResponse;
    } catch {
      return;
    }

    if (message.id !== undefined && (Object.hasOwn(message, 'result') || message.error)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new AccountProviderError(
          'protocol_error',
          redactText(message.error.message ?? `JSON-RPC error ${message.error.code ?? 'unknown'}`),
        ));
      } else {
        pending.resolve(redactValue(message.result));
      }
      return;
    }

    if (message.method) {
      const params = redactValue(message.params);
      const history = this.notificationHistory.get(message.method) ?? [];
      history.push(params);
      if (history.length > 20) history.shift();
      this.notificationHistory.set(message.method, history);
      for (const listener of this.notificationListeners.get(message.method) ?? []) listener(params);
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.notificationWaiters) {
      clearTimeout(waiter.timer);
      this.notificationListeners.get(waiter.method)?.delete(waiter.listener);
      waiter.reject(error);
    }
    this.notificationWaiters.clear();
  }
}
