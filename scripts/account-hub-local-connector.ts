import {
  acquireMemberLocalLease,
  probeMemberLocalAccount,
  readMemberLocalConnectorConfig,
  releaseMemberLocalLease,
  submitMemberLocalAccountState,
} from '../server/accountHub/memberLocalConnector.js';
import type { MemberLocalConnectorConfig } from '../server/accountHub/memberLocalConnector.js';

function configPath(argv: readonly string[]): string {
  const index = argv.indexOf('--config');
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) {
    throw new Error('用法: pnpm account-hub:connector -- --config /absolute/path/connector.json [--watch]');
  }
  return value;
}

async function reportOnce(config: MemberLocalConnectorConfig): Promise<void> {
  const report = await probeMemberLocalAccount(config);
  await submitMemberLocalAccountState(config, report);
  process.stdout.write(`账号状态已安全上报：${config.provider} / ${report.state}\n`);
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}

async function main(): Promise<void> {
  const file = configPath(process.argv.slice(2));
  const watch = process.argv.includes('--watch');
  const hold = process.argv.includes('--hold');
  if (hold && !watch) throw new Error('--hold 必须与 --watch 一起使用');
  const config = await readMemberLocalConnectorConfig(file);
  if (hold && !config.accountId) throw new Error('--hold 需要在配置文件中设置 accountId');
  if (!watch) {
    await reportOnce(config);
    return;
  }

  const stopped = new AbortController();
  const stop = () => stopped.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let leaseId: string | undefined;
  try {
    while (!stopped.signal.aborted) {
      await reportOnce(config);
      if (hold) {
        leaseId = await acquireMemberLocalLease(config, leaseId);
        process.stdout.write('本设备已取得账号协调锁；连接器会持续续租。\n');
      }
      await sleep(config.intervalSeconds * 1_000, stopped.signal);
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (hold && leaseId) {
      try {
        await releaseMemberLocalLease(config, leaseId);
        process.stdout.write('已仅释放本设备协调锁；Codex/Claude 登录状态保持不变。\n');
      } catch {
        process.stderr.write('协调锁释放未确认，将在租约到期后自动释放；Provider 登录状态未改变。\n');
      }
    }
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : 'connector_failed';
  process.stderr.write(`${message.replace(/cd[cu]_[A-Za-z0-9_-]+/g, '[REDACTED]')}\n`);
  process.exitCode = 1;
});
