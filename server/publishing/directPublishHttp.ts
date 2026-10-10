import type { PublishToAccountResult } from './platformPublisher.js';

export function socialUploadHttpResponse(result: PublishToAccountResult): {
  statusCode: 201 | 202;
  body: {
    ok: true;
    video: unknown;
    tracking: PublishToAccountResult['tracking'];
    publishRecord: PublishToAccountResult['publishRecord'];
    deliveryStatus: 'published' | 'provider_accepted';
    providerReceiptId?: string;
    platformPostId: string;
    platformUrl?: string;
  };
} {
  const platformPostId = String(result.platformPostId || '').trim();
  const providerReceiptId = String(result.providerReceiptId || '').trim();
  if (result.deliveryStatus === 'provider_accepted') {
    if (!providerReceiptId) {
      throw Object.assign(new Error('平台已受理发布，但没有返回可追踪回执'), { statusCode: 502 });
    }
    return {
      statusCode: 202,
      body: {
        ok: true,
        video: result.video,
        tracking: result.tracking,
        publishRecord: null,
        deliveryStatus: 'provider_accepted',
        providerReceiptId,
        platformPostId: '',
        ...(result.platformUrl ? { platformUrl: result.platformUrl } : {}),
      },
    };
  }
  if (result.deliveryStatus !== 'published' || !platformPostId) {
    throw Object.assign(new Error('平台没有返回最终发布回执'), { statusCode: 502 });
  }
  return {
    statusCode: 201,
    body: {
      ok: true,
      video: result.video,
      tracking: result.tracking,
      publishRecord: result.publishRecord,
      deliveryStatus: 'published',
      platformPostId,
      ...(providerReceiptId ? { providerReceiptId } : {}),
      ...(result.platformUrl ? { platformUrl: result.platformUrl } : {}),
    },
  };
}
