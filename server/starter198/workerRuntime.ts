export type StarterWorkerEnabledFlag =
  | 'STARTER_198_ORCHESTRATOR_WORKER_ENABLED'
  | 'STARTER_PUBLICATION_PACKAGE_WORKER_ENABLED'
  | 'STARTER_QUOTE_ARTIFACT_WORKER_ENABLED';

export type StarterWorkerRuntimeIssue =
  | 'not_explicitly_enabled'
  | 'production_dependency_missing:PB_URL'
  | 'production_dependency_missing:PB_ADMIN_EMAIL'
  | 'production_dependency_missing:PB_ADMIN_PASSWORD'
  | 'production_dependency_invalid:PB_URL';

/**
 * Starter repair workers are side-effecting background consumers. They never
 * start because a flag is absent or loosely truthy, and production cannot use
 * PocketBase's local fallback when its durable-store configuration is missing.
 */
export function starterWorkerRuntimeIssue(
  flag: StarterWorkerEnabledFlag,
  env: NodeJS.ProcessEnv = process.env,
): StarterWorkerRuntimeIssue | null {
  if (env[flag] !== 'true') return 'not_explicitly_enabled';
  if (env.NODE_ENV !== 'production') return null;
  for (const key of ['PB_URL', 'PB_ADMIN_EMAIL', 'PB_ADMIN_PASSWORD'] as const) {
    if (!env[key]?.trim()) return `production_dependency_missing:${key}`;
  }
  try {
    const url = new URL(env.PB_URL!);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      return 'production_dependency_invalid:PB_URL';
    }
  } catch {
    return 'production_dependency_invalid:PB_URL';
  }
  return null;
}
