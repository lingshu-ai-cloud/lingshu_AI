import {
  browserVideoUrl,
  studioGenerationIsVerified,
  titleFromVideoPath,
  type PublishPlatform,
  type PublishQueueItem,
} from '../../lib/publishQueueState';
import { PLATFORM_META } from './publishPlatformMeta';
import type { PublishAccount } from './usePublishingAccounts';

const ALL_PUBLISH_PLATFORMS = Object.keys(PLATFORM_META) as PublishPlatform[];

export function derivePublishPanelSelection(
  items: PublishQueueItem[],
  accounts: PublishAccount[],
  activeItemId: string,
  pendingTargetAccountIds: string[],
) {
  const connectedAccounts = accounts.filter(account => account.status === 'connected' && account.platform !== 'tiktok');
  const activeItem = items.find(item => item.id === activeItemId) || items[0] || null;
  const activePreviewUrl = activeItem?.previewUrl || browserVideoUrl(activeItem?.videoPath);
  const activeCalendarPost = Boolean(activeItem?.calendarPostIds?.length);
  const pendingCalendarItems = items
    .filter(item => (
      ['ready', 'partial', 'failed'].includes(item.status) &&
      Boolean(item.videoPath.trim() || item.title.trim() || item.sourceProjectId || item.sourcePlatform)
    ))
    .map(item => ({
      id: item.id,
      title: item.title || titleFromVideoPath(item.videoPath),
      description: item.description,
      sourceProjectId: item.sourceProjectId,
      sourcePlatform: item.sourcePlatform,
      platforms: Array.from(new Set(
        connectedAccounts
          .filter(account => item.targetAccountIds.includes(account.id))
          .map(account => account.platform),
      )),
      deliveryMode: item.deliveryMode,
      scheduledAt: item.scheduledAt,
      status: item.status,
    }));
  const selectedTargetAccountIds = activeItem?.targetAccountIds ?? pendingTargetAccountIds;
  const selectedConnectedAccounts = connectedAccounts.filter(account => selectedTargetAccountIds.includes(account.id));
  const selectedPlatforms = Array.from(new Set(selectedConnectedAccounts.map(account => account.platform)));
  const visiblePlatforms = selectedPlatforms.length ? selectedPlatforms : ALL_PUBLISH_PLATFORMS;
  const connectedAccountIds = new Set(connectedAccounts.map(account => account.id));
  const totalAssignments = items.reduce(
    (sum, item) => sum + item.targetAccountIds.filter(id => connectedAccountIds.has(id)).length,
    0,
  );
  const publishableItems = items.filter(item => (
    item.selected &&
    item.deliveryMode !== 'flexible' &&
    (item.deliveryMode === 'now' || Boolean(item.scheduledAt)) &&
    item.videoPath.trim() &&
    item.title.trim() &&
    (!item.sourceProjectId || studioGenerationIsVerified(item)) &&
    item.targetAccountIds.some(id => connectedAccountIds.has(id)) &&
    ['ready', 'partial', 'failed'].includes(item.status)
  ));
  const immediateItems = publishableItems.filter(item => item.deliveryMode === 'now');
  const scheduledItems = publishableItems.filter(item => item.deliveryMode === 'schedule' && Boolean(item.scheduledAt));
  const flexibleItems = items.filter(item => item.selected && item.deliveryMode === 'flexible' && ['ready', 'partial', 'failed'].includes(item.status));
  const publishableAssignments = publishableItems.reduce(
    (sum, item) => sum + item.targetAccountIds.filter(id => connectedAccountIds.has(id)).length,
    0,
  );

  return {
    connectedAccounts, activeItem, activePreviewUrl, activeCalendarPost, pendingCalendarItems,
    selectedTargetAccountIds, selectedConnectedAccounts, selectedPlatforms, visiblePlatforms,
    connectedAccountIds, totalAssignments, publishableItems, immediateItems, scheduledItems,
    flexibleItems, publishableAssignments,
  };
}
