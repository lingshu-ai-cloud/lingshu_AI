import { objectStorageHead } from '../storage/objectStorage.js';

export async function storedVideoAvailability(key: string, head = (objectKey: string) => objectStorageHead(objectKey, { signal: AbortSignal.timeout(6_000) })): Promise<'available' | 'missing' | 'unavailable'> {
  try {
    const object = await head(key);
    return object && object.size > 0 ? 'available' : 'missing';
  } catch { return 'unavailable'; }
}
