export type ClearableOAuthPlatform = 'youtube' | 'meta' | 'instagram' | 'tiktok';

export interface AdminOAuthConfig {
  admin: string;
  updatedAt: string | null;
  disabledPlatforms?: ClearableOAuthPlatform[];
  callbacks: {
    youtube: string;
    instagram: string;
    facebook: string;
    tiktok: string;
  };
  values: {
    youtubeOAuthClientId: string;
    youtubeOAuthClientSecret: string;
    metaSocialAppId: string;
    metaSocialAppSecret: string;
    instagramAppId: string;
    instagramAppSecret: string;
    tiktokClientKey: string;
    tiktokClientSecret: string;
    advancedManualConnectEnabled: boolean;
  };
  secretSet: {
    youtubeOAuthClientSecret: boolean;
    metaSocialAppSecret: boolean;
    instagramAppSecret: boolean;
    tiktokClientSecret: boolean;
  };
  secretLength?: {
    youtubeOAuthClientSecret: number;
    metaSocialAppSecret: number;
    instagramAppSecret: number;
    tiktokClientSecret: number;
  };
}

type AdminOAuthConfigResponse = Omit<Partial<AdminOAuthConfig>, 'values' | 'callbacks' | 'secretSet'> & {
  values?: Partial<AdminOAuthConfig['values']>;
  callbacks?: Partial<AdminOAuthConfig['callbacks']>;
  secretSet?: Partial<AdminOAuthConfig['secretSet']>;
};

export function normalizeAdminOAuthConfig(input: AdminOAuthConfigResponse): AdminOAuthConfig {
  const text = (value: unknown): string => typeof value === 'string' ? value : '';
  const values = input.values;
  const callbacks = input.callbacks;
  const secrets = input.secretSet;
  return {
    ...input,
    admin: text(input.admin),
    updatedAt: input.updatedAt ?? null,
    callbacks: {
      youtube: text(callbacks?.youtube), facebook: text(callbacks?.facebook),
      instagram: text(callbacks?.instagram), tiktok: text(callbacks?.tiktok),
    },
    values: {
      youtubeOAuthClientId: text(values?.youtubeOAuthClientId),
      youtubeOAuthClientSecret: text(values?.youtubeOAuthClientSecret),
      metaSocialAppId: text(values?.metaSocialAppId), metaSocialAppSecret: text(values?.metaSocialAppSecret),
      instagramAppId: text(values?.instagramAppId), instagramAppSecret: text(values?.instagramAppSecret),
      tiktokClientKey: text(values?.tiktokClientKey), tiktokClientSecret: text(values?.tiktokClientSecret),
      advancedManualConnectEnabled: values?.advancedManualConnectEnabled === true,
    },
    secretSet: {
      youtubeOAuthClientSecret: secrets?.youtubeOAuthClientSecret === true,
      metaSocialAppSecret: secrets?.metaSocialAppSecret === true,
      instagramAppSecret: secrets?.instagramAppSecret === true,
      tiktokClientSecret: secrets?.tiktokClientSecret === true,
    },
  };
}
