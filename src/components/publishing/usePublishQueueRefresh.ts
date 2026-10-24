import { useEffect } from 'react';
import { PUBLISH_QUEUE_UPDATED_EVENT, mergePublishItems, readStoredPublishQueue, type PublishQueueItem } from '../../lib/publishQueueState';

export function usePublishQueueRefresh(storageScope: string | undefined, setItems: (update: (previous: PublishQueueItem[]) => PublishQueueItem[]) => void) {
  useEffect(() => {
    const refreshQueue = (event: Event) => {
      const detail = (event as CustomEvent<{ storageScope?: string }>).detail;
      if (String(detail?.storageScope || '') !== String(storageScope || '')) return;
      setItems(previous => mergePublishItems(previous, readStoredPublishQueue(storageScope)));
    };
    window.addEventListener(PUBLISH_QUEUE_UPDATED_EVENT, refreshQueue);
    return () => window.removeEventListener(PUBLISH_QUEUE_UPDATED_EVENT, refreshQueue);
  }, [setItems, storageScope]);
}
