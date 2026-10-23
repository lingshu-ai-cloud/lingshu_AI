export interface AdDirectoryAccount {
  key: string; connectionId: string; accountId: string; name: string; currency: string;
  provider: string; localConnectionId?: string;
}
export interface AdAccountDirectory { items: AdDirectoryAccount[]; warnings: string[] }
export interface MetaAdAsset {
  accountId: string; adId: string; adName: string; creativeId: string; creativeName: string;
  configuredStatus: string; effectiveStatus: string; pageId: string; videoIds: string[];
  imageHashes: string[]; thumbnailUrl: string; checkedAt: string;
  localSource: 'unverified';
}
