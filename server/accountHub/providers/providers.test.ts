import assert from 'node:assert/strict';
import test from 'node:test';
import { parseClaudeAuthStatus } from './claude.js';
import { normalizeCodexUsage, publicStatusFromAccount } from './codex.js';
import { redactText, redactValue } from './redaction.js';
import { SafeProcessRunner } from './safeProcess.js';

test('redaction removes structured and free-form credentials', () => {
  const source = 'Bearer abc.def.ghi {"accessToken":"secret-token"} sk-ant-abcdefghijk api_key=value';
  const redacted = redactText(source);
  assert.doesNotMatch(redacted, /secret-token|abcdefghijk|api_key=value|Bearer abc/);
  assert.deepEqual(redactValue({ nested: { refresh_token: 'refresh-me' }, safe: 'visible' }), {
    nested: { refresh_token: '[REDACTED]' }, safe: 'visible',
  });
});

test('safe process does not use a shell or inherit ambient secrets', async () => {
  const previous = process.env.ACCOUNT_HUB_SHOULD_NOT_LEAK;
  process.env.ACCOUNT_HUB_SHOULD_NOT_LEAK = 'top-secret';
  try {
    const runner = new SafeProcessRunner({ allowedExecutables: [process.execPath] });
    const result = await runner.run({
      command: process.execPath,
      args: ['-e', 'console.log(JSON.stringify(process.env))'],
      timeoutMs: 2_000,
    });
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stdout, /ACCOUNT_HUB_SHOULD_NOT_LEAK|top-secret/);
    assert.throws(() => runner.start({
      command: process.execPath,
      args: ['-e', ''],
      env: { ANTHROPIC_API_KEY: 'forbidden' },
      timeoutMs: 100,
    }), /不允许/);
  } finally {
    if (previous === undefined) delete process.env.ACCOUNT_HUB_SHOULD_NOT_LEAK;
    else process.env.ACCOUNT_HUB_SHOULD_NOT_LEAK = previous;
  }
});

test('safe process redacts output and times out', async () => {
  const runner = new SafeProcessRunner({ allowedExecutables: [process.execPath] });
  const redacted = await runner.run({
    command: process.execPath,
    args: ['-e', 'console.log(JSON.stringify({accessToken:"visible-secret"})); console.error("Bearer abcdefghijk")'],
    timeoutMs: 2_000,
  });
  assert.doesNotMatch(`${redacted.stdout}${redacted.stderr}`, /visible-secret|abcdefghijk/);
  const timed = await runner.run({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    timeoutMs: 40,
  });
  assert.equal(timed.reason, 'timeout');
});

test('Codex parsers keep only public identity and normalized usage', () => {
  const status = publicStatusFromAccount({
    account: {
      type: 'chatgpt', email: 'owner@example.test', planType: 'pro',
      accessToken: 'must-not-be-selected',
    },
  });
  assert.deepEqual(status.account, { email: 'owner@example.test', plan: 'pro', authMode: 'chatgpt' });
  assert.doesNotMatch(JSON.stringify(status), /must-not-be-selected|accessToken/);

  const usage = normalizeCodexUsage({
    rateLimitsByLimitId: {
      codex: {
        limitId: 'codex', planType: 'pro',
        primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        secondary: { usedPercent: 60, windowDurationMins: 10_080, resetsAt: 1_800_604_800 },
      },
    },
    credits: { remaining: 12 },
  }, {
    summary: { lifetimeTokens: 123_456 },
    dailyUsageBuckets: [{ startDate: '2026-09-21', tokens: 1_234 }],
  });
  assert.equal(usage.limits[0]?.primary?.remainingPercent, 75);
  assert.equal(usage.limits[0]?.secondary?.remainingPercent, 40);
  assert.equal(usage.creditsRemaining, 12);
  assert.equal(usage.tokenUsage?.lifetimeTokens, 123_456);
});

test('Claude parser returns no credential fields', () => {
  const parsed = parseClaudeAuthStatus({
    code: 0,
    stdout: JSON.stringify({ loggedIn: true, email: 'claude@example.test', subscriptionType: 'max', accessToken: 'hidden' }),
    stderr: '',
  });
  assert.equal(parsed.state, 'authenticated');
  assert.equal(parsed.account?.email, 'claude@example.test');
  assert.equal(parsed.account?.plan, 'max');
  assert.doesNotMatch(JSON.stringify(parsed), /accessToken|hidden/);
  assert.equal(parseClaudeAuthStatus({ code: 1, stdout: '', stderr: 'Not logged in' }).state, 'unauthenticated');
});
