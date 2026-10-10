export type WeeklyProductionEnvironmentCheck = {
  key: string;
  ready: boolean;
  reason: string | null;
};

export type WeeklyProductionEnvironmentReadiness = {
  ready: boolean;
  checks: WeeklyProductionEnvironmentCheck[];
  runtimeEvidenceRequired: string[];
};

const present = (env: NodeJS.ProcessEnv, key: string) => Boolean(String(env[key] ?? '').trim());
const enabled = (env: NodeJS.ProcessEnv, key: string) => String(env[key] ?? '').trim().toLowerCase() === 'true';

/**
 * Static release admission only. It deliberately never returns provider tokens
 * or claims that a tenant has connected an account; those are verified from
 * durable tenant records immediately before each real effect.
 */
export function evaluateWeeklyProductionEnvironment(
  env: NodeJS.ProcessEnv,
  atomicPublicationStore: boolean,
): WeeklyProductionEnvironmentReadiness {
  const checks: WeeklyProductionEnvironmentCheck[] = [
    {
      key: 'postgres_business_store',
      ready: env.DATA_BACKEND === 'postgres' && present(env, 'DATABASE_URL'),
      reason: env.DATA_BACKEND === 'postgres' && present(env, 'DATABASE_URL') ? null : 'postgres_business_store_not_configured',
    },
    {
      key: 'atomic_publication_lease',
      ready: atomicPublicationStore,
      reason: atomicPublicationStore ? null : 'publication_atomic_store_unavailable',
    },
    {
      key: 'durable_worker_queue',
      ready: env.QUEUE_BACKEND === 'bullmq' && present(env, 'REDIS_URL'),
      reason: env.QUEUE_BACKEND === 'bullmq' && present(env, 'REDIS_URL') ? null : 'durable_worker_queue_not_configured',
    },
    {
      key: 'production_auth_fail_closed',
      ready: env.DISABLE_LOCAL_AUTH_FALLBACK === 'true' && env.ENABLE_LOCAL_DEV_FALLBACK !== 'true',
      reason: env.DISABLE_LOCAL_AUTH_FALLBACK === 'true' && env.ENABLE_LOCAL_DEV_FALLBACK !== 'true' ? null : 'production_auth_fallback_enabled',
    },
    {
      key: 'meta_social_oauth',
      ready: present(env, 'META_SOCIAL_APP_ID') && present(env, 'META_SOCIAL_APP_SECRET'),
      reason: present(env, 'META_SOCIAL_APP_ID') && present(env, 'META_SOCIAL_APP_SECRET') ? null : 'meta_social_oauth_not_configured',
    },
    {
      key: 'instagram_publication_scope',
      ready: enabled(env, 'INSTAGRAM_CONTENT_PUBLISH_ENABLED'),
      reason: enabled(env, 'INSTAGRAM_CONTENT_PUBLISH_ENABLED') ? null : 'instagram_publication_disabled',
    },
    {
      key: 'tiktok_direct_post',
      ready: present(env, 'TIKTOK_CLIENT_KEY') && present(env, 'TIKTOK_CLIENT_SECRET') && env.TIKTOK_DIRECT_POST_RELEASE_MODE === 'approved',
      reason: present(env, 'TIKTOK_CLIENT_KEY') && present(env, 'TIKTOK_CLIENT_SECRET') && env.TIKTOK_DIRECT_POST_RELEASE_MODE === 'approved' ? null : 'tiktok_direct_post_not_approved',
    },
  ];
  return {
    ready: checks.every(check => check.ready),
    checks,
    runtimeEvidenceRequired: [
      'tenant_authenticated_scope',
      'weekly_package_and_execution_graph',
      'whatsapp_connected_account_and_approved_recipient',
      'messenger_connected_page_and_scoped_recipient',
      'instagram_connected_professional_account_and_scoped_recipient',
      'publication_account_token_and_provider_capability_receipt',
    ],
  };
}
