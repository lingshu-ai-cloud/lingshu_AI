import { validateOutboxWebhookTarget } from '../digitalEmployees/outboxWebhookSecurity.js';
import { validCredentialEncryptionKey } from '../security/credentialEnvelope.js';

export type ProductionConfigurationIssue = {
  name: string;
  reason: 'missing' | 'too_short' | 'placeholder' | 'invalid' | 'reused' | 'insecure_override';
};

const REQUIRED_SECRETS: ReadonlyArray<{ name: string; minLength: number }> = [
  { name: 'PB_ADMIN_PASSWORD', minLength: 16 },
  { name: 'WORKBENCH_ADMIN_PASSWORD', minLength: 16 },
  { name: 'RENDER_TOKEN_SECRET', minLength: 32 },
  { name: 'ASSET_ACCESS_SECRET', minLength: 32 },
  { name: 'TENANT_PLATFORM_APP_KEY', minLength: 32 },
  { name: 'CREDENTIAL_ENCRYPTION_KEY', minLength: 32 },
  { name: 'REGISTRATION_CREDENTIAL_KEY', minLength: 32 },
  { name: 'SUPPORT_ACCESS_SECRET', minLength: 32 },
  { name: 'CRAWL_WORKER_TOKEN', minLength: 32 },
  { name: 'METRICS_TOKEN', minLength: 32 },
] as const;

const PLACEHOLDER = /change[-_ ]?me|generate[-_ ]?with|replace[-_ ]?me|placeholder|example\.com|smoke[-_ ]?only|dev[-_ ]?insecure|test[-_ ]?(?:secret|password|token|key)/i;

function value(env: NodeJS.ProcessEnv, name: string): string {
  return String(env[name] || '').trim();
}

function privatePublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1'
    || /^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some(part => part > 255)) return true;
  return octets[0] === 10 || octets[0] === 127 || octets[0] === 0
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function obviouslyWeakSecret(secret: string): boolean {
  const candidate = secret.replace(/^(?:base64|hex):/i, '');
  if (new Set(candidate).size < 8) return true;
  for (let size = 1; size <= Math.min(16, Math.floor(candidate.length / 2)); size += 1) {
    if (candidate.length % size === 0
      && candidate.slice(0, size).repeat(candidate.length / size) === candidate) return true;
  }
  const normalized = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
  return [
    'abcdefghijklmnopqrstuvwxyz',
    'zyxwvutsrqponmlkjihgfedcba',
    '0123456789',
    '9876543210',
    '0123456789abcdef',
    'abcdefghijklmnopqrstuvwxyz0123456789',
    'qwertyuiopasdfghjklzxcvbnm',
  ].some(sequence => normalized.length >= 16 && (sequence.repeat(8).includes(normalized)
    || normalized === sequence.repeat(Math.ceil(normalized.length / sequence.length)).slice(0, normalized.length)));
}

export function validProductionPublicBaseUrl(raw: string): boolean {
  if (!raw || PLACEHOLDER.test(raw)) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      && !parsed.search && !parsed.hash && (parsed.pathname === '/' || parsed.pathname === '')
      && Boolean(parsed.hostname) && !privatePublicHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export function productionSecretIssue(name: string, secret: string, minLength = 32): ProductionConfigurationIssue | null {
  if (!secret) return { name, reason: 'missing' };
  if (PLACEHOLDER.test(secret)) return { name, reason: 'placeholder' };
  if (secret.length < minLength) return { name, reason: 'too_short' };
  if (obviouslyWeakSecret(secret)) return { name, reason: 'invalid' };
  return null;
}

export function requireProductionSecret(name: string, env: NodeJS.ProcessEnv = process.env, minLength = 32): string {
  const secret = value(env, name);
  if (env.NODE_ENV !== 'production') return secret;
  const issue = productionSecretIssue(name, secret, minLength);
  if (issue) throw new Error(`${name} is invalid for production (${issue.reason})`);
  return secret;
}

export function assertProductionConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  const result = validateProductionConfiguration(env);
  if (!result.ok) {
    const summary = result.issues.map(issue => `${issue.name}:${issue.reason}`).join(', ');
    throw new Error(`production configuration invalid: ${summary}`);
  }
}

export function validateProductionConfiguration(env: NodeJS.ProcessEnv = process.env): {
  ok: boolean;
  issues: ProductionConfigurationIssue[];
} {
  if (env.NODE_ENV !== 'production') return { ok: true, issues: [] };
  const issues: ProductionConfigurationIssue[] = [];
  const email = value(env, 'PB_ADMIN_EMAIL');
  if (!email) issues.push({ name: 'PB_ADMIN_EMAIL', reason: 'missing' });
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || PLACEHOLDER.test(email)) issues.push({ name: 'PB_ADMIN_EMAIL', reason: 'invalid' });
  const workbenchEmail = value(env, 'WORKBENCH_ADMIN_EMAIL');
  if (!workbenchEmail) issues.push({ name: 'WORKBENCH_ADMIN_EMAIL', reason: 'missing' });
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workbenchEmail) || PLACEHOLDER.test(workbenchEmail)) issues.push({ name: 'WORKBENCH_ADMIN_EMAIL', reason: 'invalid' });
  const publicBaseUrl = value(env, 'PUBLIC_BASE_URL');
  if (!publicBaseUrl) issues.push({ name: 'PUBLIC_BASE_URL', reason: 'missing' });
  else if (!validProductionPublicBaseUrl(publicBaseUrl)) issues.push({ name: 'PUBLIC_BASE_URL', reason: 'invalid' });
  const trustProxyHops = value(env, 'TRUST_PROXY_HOPS');
  if (!trustProxyHops) issues.push({ name: 'TRUST_PROXY_HOPS', reason: 'missing' });
  else if (!/^\d+$/.test(trustProxyHops) || Number(trustProxyHops) < 1 || Number(trustProxyHops) > 10) {
    issues.push({ name: 'TRUST_PROXY_HOPS', reason: 'invalid' });
  }

  const secrets = new Map<string, string>();
  for (const requirement of REQUIRED_SECRETS) {
    const secret = value(env, requirement.name);
    const issue = productionSecretIssue(requirement.name, secret, requirement.minLength);
    if (issue) issues.push(issue);
    else secrets.set(requirement.name, secret);
  }
  if (!issues.some(issue => issue.name === 'CREDENTIAL_ENCRYPTION_KEY')
    && !validCredentialEncryptionKey(value(env, 'CREDENTIAL_ENCRYPTION_KEY'))) {
    issues.push({ name: 'CREDENTIAL_ENCRYPTION_KEY', reason: 'invalid' });
  }
  const previousCrawlWorkerToken = value(env, 'CRAWL_WORKER_TOKEN_PREVIOUS');
  if (previousCrawlWorkerToken) {
    const issue = productionSecretIssue('CRAWL_WORKER_TOKEN_PREVIOUS', previousCrawlWorkerToken, 32);
    if (issue) issues.push(issue);
    else secrets.set('CRAWL_WORKER_TOKEN_PREVIOUS', previousCrawlWorkerToken);
  }
  const owners = new Map<string, string[]>();
  for (const [name, secret] of secrets) owners.set(secret, [...(owners.get(secret) || []), name]);
  for (const names of owners.values()) {
    if (names.length > 1) for (const name of names) issues.push({ name, reason: 'reused' });
  }

  for (const name of ['ENABLE_LOCAL_STORE_FALLBACK', 'ALLOW_NON_ATOMIC_DIGITAL_EMPLOYEE_STORE', 'DISABLE_DIGITAL_EMPLOYEE_WORKER']) {
    if (value(env, name).toLowerCase() === 'true') issues.push({ name, reason: 'insecure_override' });
  }
  if (value(env, 'DISABLE_LOCAL_AUTH_FALLBACK').toLowerCase() !== 'true') {
    issues.push({ name: 'DISABLE_LOCAL_AUTH_FALLBACK', reason: 'insecure_override' });
  }
  if (value(env, 'DISABLE_DESKTOP_OPEN_OUTPUT').toLowerCase() !== 'true') {
    issues.push({ name: 'DISABLE_DESKTOP_OPEN_OUTPUT', reason: 'insecure_override' });
  }
  if (value(env, 'SUBSCRIPTION_ENFORCED').toLowerCase() !== 'true') {
    issues.push({ name: 'SUBSCRIPTION_ENFORCED', reason: 'insecure_override' });
  }
  const supportSessionTtlMs = Number(value(env, 'SUPPORT_ACCESS_SESSION_TTL_MS') || 30 * 60_000);
  if (!Number.isSafeInteger(supportSessionTtlMs) || supportSessionTtlMs < 5 * 60_000 || supportSessionTtlMs > 60 * 60_000) {
    issues.push({ name: 'SUPPORT_ACCESS_SESSION_TTL_MS', reason: 'invalid' });
  }
  const metaGraphVersion = value(env, 'META_GRAPH_VERSION') || 'v25.0';
  if (!/^v\d{1,3}\.\d{1,3}$/.test(metaGraphVersion)) {
    issues.push({ name: 'META_GRAPH_VERSION', reason: 'invalid' });
  }
  const whatsappProviderTimeoutMs = Number(value(env, 'WHATSAPP_PROVIDER_TIMEOUT_MS') || 30_000);
  if (!Number.isSafeInteger(whatsappProviderTimeoutMs)
    || whatsappProviderTimeoutMs < 1_000 || whatsappProviderTimeoutMs > 120_000) {
    issues.push({ name: 'WHATSAPP_PROVIDER_TIMEOUT_MS', reason: 'invalid' });
  }
  const providerHttpTimeoutMs = Number(value(env, 'PROVIDER_HTTP_TIMEOUT_MS') || 30_000);
  if (!Number.isSafeInteger(providerHttpTimeoutMs)
    || providerHttpTimeoutMs < 1_000 || providerHttpTimeoutMs > 120_000) {
    issues.push({ name: 'PROVIDER_HTTP_TIMEOUT_MS', reason: 'invalid' });
  }
  const tiktokDirectPostAudited = value(env, 'TIKTOK_DIRECT_POST_AUDITED');
  if (tiktokDirectPostAudited && tiktokDirectPostAudited !== 'true' && tiktokDirectPostAudited !== 'false') {
    issues.push({ name: 'TIKTOK_DIRECT_POST_AUDITED', reason: 'invalid' });
  }
  const whatsappInboundReceiptLeaseMs = Number(value(env, 'WHATSAPP_INBOUND_RECEIPT_LEASE_MS') || 30 * 60_000);
  if (!Number.isSafeInteger(whatsappInboundReceiptLeaseMs)
    || whatsappInboundReceiptLeaseMs < 60_000 || whatsappInboundReceiptLeaseMs > 4 * 60 * 60_000) {
    issues.push({ name: 'WHATSAPP_INBOUND_RECEIPT_LEASE_MS', reason: 'invalid' });
  }

  const llmBackend = value(env, 'OVERSEAS_LLM_BACKEND').toLowerCase() || 'gemini';
  if (llmBackend !== 'gemini' && llmBackend !== 'qwen') {
    issues.push({ name: 'OVERSEAS_LLM_BACKEND', reason: 'invalid' });
  } else {
    const credentialName = llmBackend === 'qwen' ? 'DASHSCOPE_API_KEY' : 'GEMINI_API_KEY';
    const credentialIssue = productionSecretIssue(credentialName, value(env, credentialName), 20);
    if (credentialIssue) issues.push(credentialIssue);
  }

  const studioQwenCredential = value(env, 'DASHSCOPE_API_KEY');
  const studioMinimaxCredential = value(env, 'MINIMAX_API_KEY') || value(env, 'MINIMAX_API_TOKEN');
  const studioQwenTtsIssue = productionSecretIssue('DASHSCOPE_API_KEY', studioQwenCredential, 20);
  const studioMinimaxTtsIssue = productionSecretIssue(
    'MINIMAX_API_KEY',
    studioMinimaxCredential,
    20,
  );
  // A configured placeholder/short secondary credential is still unsafe: an
  // automatic provider fallback could select it later even when the primary is
  // currently valid.
  if (studioQwenCredential && studioQwenTtsIssue) issues.push(studioQwenTtsIssue);
  if (studioMinimaxCredential && studioMinimaxTtsIssue) issues.push(studioMinimaxTtsIssue);
  if (!studioQwenCredential && !studioMinimaxCredential) {
    issues.push({ name: 'STUDIO_TTS_CREDENTIAL', reason: 'missing' });
  }

  // Manual calendar posts use the same durable scheduler as autonomous runs.
  // Disabling it would leave accepted production work permanently queued while
  // the API and readiness endpoints appear healthy.
  const schedulerEnabled = value(env, 'PUBLISH_SCHEDULER_ENABLED').toLowerCase();
  if (schedulerEnabled !== 'true') {
    issues.push({
      name: 'PUBLISH_SCHEDULER_ENABLED',
      reason: schedulerEnabled ? 'invalid' : 'missing',
    });
  }

  if (value(env, 'DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED').toLowerCase() === 'true') {
    const accountTimeoutMs = Number(value(env, 'PUBLISH_ACCOUNT_TIMEOUT_MS') || 600_000);
    const schedulerLeaseMs = Number(value(env, 'PUBLISH_SCHEDULER_LEASE_MS') || 900_000);
    const accountTimeoutValid = Number.isSafeInteger(accountTimeoutMs)
      && accountTimeoutMs >= 30_000 && accountTimeoutMs <= 4 * 60 * 60_000;
    if (!accountTimeoutValid) issues.push({ name: 'PUBLISH_ACCOUNT_TIMEOUT_MS', reason: 'invalid' });
    if (!Number.isSafeInteger(schedulerLeaseMs) || schedulerLeaseMs < 60_000
      || (accountTimeoutValid && schedulerLeaseMs < accountTimeoutMs + 60_000)) {
      issues.push({ name: 'PUBLISH_SCHEDULER_LEASE_MS', reason: 'invalid' });
    }
    const voiceoverMode = value(env, 'DIGITAL_EMPLOYEE_VOICEOVER_MODE').toLowerCase();
    if (voiceoverMode !== 'required') {
      issues.push({
        name: 'DIGITAL_EMPLOYEE_VOICEOVER_MODE',
        reason: voiceoverMode ? 'invalid' : 'missing',
      });
    }
    const provider = value(env, 'DIGITAL_EMPLOYEE_TTS_PROVIDER').toLowerCase() || 'auto';
    if (!['auto', 'qwen', 'minimax'].includes(provider)) {
      issues.push({ name: 'DIGITAL_EMPLOYEE_TTS_PROVIDER', reason: 'invalid' });
    } else if (provider === 'qwen') {
      const issue = productionSecretIssue('DASHSCOPE_API_KEY', value(env, 'DASHSCOPE_API_KEY'), 20);
      if (issue) issues.push(issue);
    } else if (provider === 'minimax') {
      const issue = productionSecretIssue('MINIMAX_API_KEY', value(env, 'MINIMAX_API_KEY') || value(env, 'MINIMAX_API_TOKEN'), 20);
      if (issue) issues.push(issue);
    } else {
      const qwenIssue = productionSecretIssue('DASHSCOPE_API_KEY', value(env, 'DASHSCOPE_API_KEY'), 20);
      const minimaxIssue = productionSecretIssue('MINIMAX_API_KEY', value(env, 'MINIMAX_API_KEY') || value(env, 'MINIMAX_API_TOKEN'), 20);
      if (qwenIssue && minimaxIssue) {
        const configuredIssue = value(env, 'DASHSCOPE_API_KEY') ? qwenIssue
          : value(env, 'MINIMAX_API_KEY') || value(env, 'MINIMAX_API_TOKEN') ? minimaxIssue
            : { name: 'DIGITAL_EMPLOYEE_TTS_CREDENTIAL', reason: 'missing' as const };
        issues.push(configuredIssue);
      }
    }
  }

  const webhookUrl = value(env, 'DIGITAL_EMPLOYEE_EVENT_WEBHOOK_URL');
  if (webhookUrl) {
    try {
      validateOutboxWebhookTarget({
        rawUrl: webhookUrl,
        production: true,
        allowedOrigins: value(env, 'DIGITAL_EMPLOYEE_EVENT_WEBHOOK_ALLOWED_ORIGINS'),
      });
    } catch (error) {
      const code = String((error as Error)?.message || error);
      issues.push({
        name: code.includes('allowed_origin') ? 'DIGITAL_EMPLOYEE_EVENT_WEBHOOK_ALLOWED_ORIGINS' : 'DIGITAL_EMPLOYEE_EVENT_WEBHOOK_URL',
        reason: code.endsWith('_required') ? 'missing' : 'invalid',
      });
    }
    const webhookIssue = productionSecretIssue('DIGITAL_EMPLOYEE_EVENT_WEBHOOK_SECRET', value(env, 'DIGITAL_EMPLOYEE_EVENT_WEBHOOK_SECRET'));
    if (webhookIssue) issues.push(webhookIssue);
  }

  return { ok: issues.length === 0, issues };
}
