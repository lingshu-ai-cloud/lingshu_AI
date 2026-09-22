import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { redactText } from './redaction.js';
import { AccountProviderError } from './types.js';

const INHERITED_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SYSTEMROOT',
  'COMSPEC',
  'PATHEXT',
]);

const PROVIDER_ENV_KEYS = new Set(['CODEX_HOME', 'CLAUDE_CONFIG_DIR']);
const FORBIDDEN_ENV_KEY = /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|COOKIE|AUTHORIZATION)/i;

export interface SafeProcessInvocation {
  command: string;
  args: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  input?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

export interface SafeProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  reason: 'exited' | 'timeout' | 'cancelled' | 'spawn_error';
  error?: string;
}

export interface SafeRunningProcess {
  readonly result: Promise<SafeProcessResult>;
  writeLine(value: unknown): void;
  write(value: string): void;
  closeInput(): void;
  cancel(reason?: string): void;
}

export interface SafeProcessRunnerLike {
  run(invocation: SafeProcessInvocation): Promise<SafeProcessResult>;
  start(invocation: SafeProcessInvocation): SafeRunningProcess;
}

type SpawnFunction = typeof spawn;

function buildEnvironment(overrides: Readonly<Record<string, string>> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of INHERITED_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (!PROVIDER_ENV_KEYS.has(key) || FORBIDDEN_ENV_KEY.test(key)) {
      throw new AccountProviderError('invalid_input', `不允许向账号 CLI 传递环境变量 ${key}`);
    }
    if (value.includes('\0')) throw new AccountProviderError('invalid_input', '环境变量包含非法字符');
    env[key] = value;
  }
  return env;
}

function appendBounded(current: string, next: string, limit: number): string {
  if (current.length >= limit) return current;
  const remaining = limit - current.length;
  return current + next.slice(0, remaining);
}

function assertSafeArgument(value: string): void {
  if (value.includes('\0')) throw new AccountProviderError('invalid_input', 'CLI 参数包含非法字符');
}

export class SafeProcessRunner implements SafeProcessRunnerLike {
  private readonly allowedExecutables: Set<string>;

  constructor(options: { allowedExecutables: readonly string[]; spawnImpl?: SpawnFunction }) {
    if (options.allowedExecutables.length === 0) throw new Error('allowedExecutables must not be empty');
    this.allowedExecutables = new Set(options.allowedExecutables);
    this.spawnImpl = options.spawnImpl ?? spawn;
  }

  private readonly spawnImpl: SpawnFunction;

  run(invocation: SafeProcessInvocation): Promise<SafeProcessResult> {
    const running = this.start(invocation);
    if (invocation.input !== undefined) running.write(invocation.input);
    running.closeInput();
    return running.result;
  }

  start(invocation: SafeProcessInvocation): SafeRunningProcess {
    if (!this.allowedExecutables.has(invocation.command)) {
      throw new AccountProviderError('invalid_input', 'CLI executable is not allowlisted');
    }
    assertSafeArgument(invocation.command);
    invocation.args.forEach(assertSafeArgument);
    const env = buildEnvironment(invocation.env);
    const timeoutMs = Math.max(1, Math.floor(invocation.timeoutMs));
    const maxOutputBytes = Math.max(1024, Math.min(invocation.maxOutputBytes ?? 2_000_000, 10_000_000));
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnImpl(invocation.command, [...invocation.args], {
        cwd: invocation.cwd,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      const safeMessage = redactText(error instanceof Error ? error.message : String(error));
      return {
        result: Promise.resolve({
          code: null,
          signal: null,
          stdout: '',
          stderr: '',
          reason: 'spawn_error',
          error: safeMessage,
        }),
        writeLine() {},
        write() {},
        closeInput() {},
        cancel() {},
      };
    }

    let stdout = '';
    let stderr = '';
    let stdoutRemainder = '';
    let stderrRemainder = '';
    let settled = false;
    let stopReason: SafeProcessResult['reason'] = 'exited';
    let stopMessage: string | undefined;

    const emitLines = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      const raw = (stream === 'stdout' ? stdoutRemainder : stderrRemainder) + chunk.toString('utf8');
      const pieces = raw.split(/\r?\n/);
      const remainder = pieces.pop() ?? '';
      if (stream === 'stdout') stdoutRemainder = remainder.slice(-maxOutputBytes);
      else stderrRemainder = remainder.slice(-maxOutputBytes);
      const callback = stream === 'stdout' ? invocation.onStdoutLine : invocation.onStderrLine;
      for (const line of pieces) {
        const safeLine = redactText(line.slice(0, maxOutputBytes));
        if (stream === 'stdout') stdout = appendBounded(stdout, `${safeLine}\n`, maxOutputBytes);
        else stderr = appendBounded(stderr, `${safeLine}\n`, maxOutputBytes);
        callback?.(safeLine);
      }
    };

    child.stdout.on('data', (chunk: Buffer) => emitLines(chunk, 'stdout'));
    child.stderr.on('data', (chunk: Buffer) => emitLines(chunk, 'stderr'));

    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid || child.killed) return;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        try { child.kill(signal); } catch { /* already gone */ }
      }
    };

    const stop = (reason: 'timeout' | 'cancelled', message: string) => {
      if (settled || stopReason !== 'exited') return;
      stopReason = reason;
      stopMessage = message;
      kill('SIGTERM');
      const forceTimer = setTimeout(() => kill('SIGKILL'), 500);
      forceTimer.unref?.();
    };

    const timeout = setTimeout(() => stop('timeout', `CLI operation timed out after ${timeoutMs}ms`), timeoutMs);
    timeout.unref?.();
    const abort = () => stop('cancelled', 'CLI operation cancelled');
    if (invocation.signal?.aborted) abort();
    else invocation.signal?.addEventListener('abort', abort, { once: true });

    const result = new Promise<SafeProcessResult>((resolve) => {
      child.once('error', (error: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        invocation.signal?.removeEventListener('abort', abort);
        resolve({
          code: null,
          signal: null,
          stdout,
          stderr,
          reason: 'spawn_error',
          error: error.code === 'ENOENT' ? 'CLI executable not found' : redactText(error.message),
        });
      });
      child.once('close', (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        invocation.signal?.removeEventListener('abort', abort);
        const safeStdoutTail = redactText(stdoutRemainder);
        const safeStderrTail = redactText(stderrRemainder);
        if (safeStdoutTail) {
          stdout = appendBounded(stdout, safeStdoutTail, maxOutputBytes);
          invocation.onStdoutLine?.(safeStdoutTail);
        }
        if (safeStderrTail) {
          stderr = appendBounded(stderr, safeStderrTail, maxOutputBytes);
          invocation.onStderrLine?.(safeStderrTail);
        }
        resolve({ code, signal, stdout, stderr, reason: stopReason, error: stopMessage });
      });
    });

    return {
      result,
      writeLine(value: unknown) {
        if (!settled && child.stdin.writable) child.stdin.write(`${JSON.stringify(value)}\n`);
      },
      write(value: string) {
        if (!settled && child.stdin.writable) child.stdin.write(value);
      },
      closeInput() {
        if (!settled && child.stdin.writable) child.stdin.end();
      },
      cancel(reason = 'CLI operation cancelled') {
        stop('cancelled', redactText(reason));
      },
    };
  }
}
