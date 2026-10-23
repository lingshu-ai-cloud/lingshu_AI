export type PlatformAdResourceLevel = 'campaign' | 'adset' | 'ad';

export type PlatformAdResource = {
  id: string;
  provider: 'meta';
  connectionId: string;
  accountId: string;
  providerResourceId: string;
  level: PlatformAdResourceLevel;
  parentResourceId: string;
  campaignId: string;
  adsetId: string;
  name: string;
  configuredStatus: string;
  effectiveStatus: string;
  currency: string;
  accountTimezone: string;
  providerSnapshot: Record<string, unknown>;
  syncRunId: string;
  lastSyncedAt: string;
};

export type PlatformAdResourceSyncResult = {
  connectionId: string;
  accountId: string;
  currency: string;
  accountTimezone: string;
  syncedAt: string;
  counts: Record<PlatformAdResourceLevel, number>;
};
