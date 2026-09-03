import axios from 'axios';

export function providerRequestTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.PROVIDER_HTTP_TIMEOUT_MS || 30_000);
  if (!Number.isSafeInteger(configured) || configured < 1_000 || configured > 120_000) {
    throw new Error('PROVIDER_HTTP_TIMEOUT_MS_invalid');
  }
  return configured;
}

/** All non-upload provider calls inherit a bounded timeout by default. */
export const providerHttp = axios.create({ timeout: providerRequestTimeoutMs() });
