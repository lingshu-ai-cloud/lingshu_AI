import {
  probeMemberLocalAccount,
  readMemberLocalConnectorConfig,
  reconcileMemberLocalLease,
  stopMemberLocalLeaseSession,
  submitMemberLocalAccountState,
} from '../server/accountHub/memberLocalConnector.js';
import type { MemberLocalConnectorConfig } from '../server/accountHub/memberLocalConnector.js';
import type { MemberAccountStateReport } from '../server/accountHub/types.js';

function configPath(argv: readonly string[]): string {
  const index = argv.indexOf('--config');
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) {
    throw new Error('用法: pnpm account-hub:connector -- --config /absolute/path/connector.json [--watch --hold]');
  }
  return value;
}

async function reportOnce(config: MemberLocalConnectorConfig): Promise<MemberAccountStateReport> {
  const report = await probeMemberLocalAccount(config);
  await submitMemberLocalAccountState(config, report);
  process.stdout.write(`账号状态已安全上报：${config.provider} / ${report.state}\n`);
  return report;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'connector_failed';
  return message.replace(/cd[cu]_[A-Za-z0-9_-]+/g, '[REDACTED]');
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
      try {
        const report = await reportOnce(config);
        if (hold) {
          // Assign only after the network operation succeeds. On report,
          // acquire, or release failure the previous capability is retained
          // and retried on the next heartbeat.
          const reconciled = await reconcileMemberLocalLease(config, report, leaseId);
          leaseId = reconciled.leaseId;
          if (reconciled.action === 'acquired') {
            process.stdout.write('本设备已取得账号协调锁；连接器会持续续租。\n');
          } else if (reconciled.action === 'released') {
            process.stdout.write('检测到本机账号已明确退出，已仅释放协调锁；Provider 登录状态未被修改。\n');
          }
        }
      } catch (error) {
        process.stderr.write(`本轮连接器同步失败，将保留当前协调状态并重试：${safeErrorMessage(error)}\n`);
      }
      await sleep(config.intervalSeconds * 1_000, stopped.signal);
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    const stoppedLease = stopMemberLocalLeaseSession(leaseId);
    if (hold && stoppedLease.action === 'retained') {
      process.stdout.write('连接器已停止续租；活跃协调锁不会主动释放，将按 TTL 自然到期，避免误交接账号。\n');
    }
  }
}

void main().catch((error) => {
  process.stderr.write(`${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
});
