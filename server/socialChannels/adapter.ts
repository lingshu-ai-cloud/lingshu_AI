import type {
  AccountContentSyncPage,
  ChannelCapabilityMatrix,
  DouyinCapabilityContext,
  PublicationAsset,
  PublicationCopy,
  PublicationSpecificationCheck,
  SocialChannelId,
  SocialSyncCursor,
} from '../../shared/contracts/socialChannels.js';

export interface ChannelArtifactInput {
  contentHash: string;
  copy: PublicationCopy;
  assets: PublicationAsset[];
}

export interface ChannelCapabilityEvaluationContext {
  evaluatedAt?: Date;
  assistedBrowserE2E?: 'passed' | 'failed' | 'not_run';
  douyin?: DouyinCapabilityContext;
}

export interface AccountContentSyncInput {
  tenantId: string;
  accountId: string;
  accessToken?: string;
  cursor?: SocialSyncCursor;
  now?: Date;
  capabilityContext?: ChannelCapabilityEvaluationContext;
}

export interface OfficialPublishInput {
  tenantId: string;
  accountId: string;
  accessToken: string;
  packageId: string;
  packageHash: string;
  contentHash: string;
  idempotencyKey: string;
  capabilityContext?: ChannelCapabilityEvaluationContext;
}

export interface OfficialPublishReceipt {
  /** Acceptance is not proof that a public post exists. */
  status: 'provider_accepted' | 'reconciliation_required' | 'rejected';
  providerRequestId?: string;
  externalContentId?: string;
  receiptHash: string;
  acceptedAt?: string;
  reasonCode?: string;
}

export interface ChannelAdapter {
  readonly channelId: SocialChannelId;
  capabilityMatrix(context?: ChannelCapabilityEvaluationContext): ChannelCapabilityMatrix;
  validateArtifact(input: ChannelArtifactInput): PublicationSpecificationCheck[];
  buildPublishingInstructions(input: ChannelArtifactInput): string[];
  publishOfficially?(input: OfficialPublishInput): Promise<OfficialPublishReceipt>;
  syncAccountContent?(input: AccountContentSyncInput): Promise<AccountContentSyncPage>;
}

export class ChannelAdapterError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
    message = code,
  ) {
    super(message);
    this.name = 'ChannelAdapterError';
  }
}
