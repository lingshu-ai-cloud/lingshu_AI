function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function emailList(value: unknown): string[] {
  return String(value ?? '')
    .split(/[\s,;]+/)
    .map(normalizeEmail)
    .filter(Boolean);
}

/**
 * One platform-admin allowlist is shared by local preview and server runtime.
 * The older variables remain read-only compatibility aliases while operators
 * migrate to PLATFORM_ADMIN_EMAILS.
 */
export function configuredPlatformAdminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...new Set([
    ...emailList(env.PLATFORM_ADMIN_EMAILS),
    ...emailList(env.ADMIN_DASHBOARD_EMAILS),
    normalizeEmail(env.LOCAL_ADMIN_EMAIL),
    normalizeEmail(env.WORKBENCH_ADMIN_EMAIL),
  ].filter(Boolean))];
}

export function isConfiguredPlatformAdminEmail(
  email: unknown,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const normalized = normalizeEmail(email);
  return Boolean(normalized) && configuredPlatformAdminEmails(env).includes(normalized);
}
