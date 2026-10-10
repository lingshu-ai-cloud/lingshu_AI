type ScopeEnvironment = Record<string, string | undefined>;

function enabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value || '').trim().toLowerCase());
}

export function tikTokDirectPostApproved(env: ScopeEnvironment = process.env): boolean {
  return String(env.TIKTOK_DIRECT_POST_RELEASE_MODE || '').trim().toLowerCase() === 'approved';
}

export function tikTokOAuthScopes(env: ScopeEnvironment = process.env): string[] {
  const scopes = ['user.info.basic'];
  if (enabled(env.TIKTOK_READ_FEATURES_ENABLED)) {
    scopes.push('user.info.profile', 'user.info.stats', 'video.list');
  }
  if (tikTokDirectPostApproved(env)) scopes.push('video.publish');
  return scopes;
}

export function metaOAuthScopes(
  platform: 'facebook' | 'instagram' | 'combined',
  _env: ScopeEnvironment = process.env,
): string[] {
  const scopes = new Set(['pages_show_list', 'pages_read_engagement']);
  if (platform === 'facebook' || platform === 'combined') {
    scopes.add('pages_manage_posts');
  }
  if (platform === 'instagram' || platform === 'combined') {
    scopes.add('instagram_basic');
    scopes.add('instagram_content_publish');
  }
  return Array.from(scopes);
}

/** Instagram Login grants IG User tokens independently of a Facebook Page. */
export function instagramLoginOAuthScopes(): string[] {
  return [
    'instagram_business_basic',
    'instagram_business_content_publish',
  ];
}

export function youtubeOAuthScopes(env: ScopeEnvironment = process.env): string[] {
  const scopes = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
  ];
  if (enabled(env.YOUTUBE_COMMENT_FEATURES_ENABLED)) {
    scopes.push('https://www.googleapis.com/auth/youtube.force-ssl');
  }
  if (enabled(env.YOUTUBE_ANALYTICS_FEATURES_ENABLED)) {
    scopes.push('https://www.googleapis.com/auth/yt-analytics.readonly');
  }
  return scopes;
}
