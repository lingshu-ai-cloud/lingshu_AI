import { getToken } from './auth';

export interface PresenterOnboardingDraft {
  name: string;
  videoFile?: File;
  photoFile?: File;
  photoSource?: 'frame' | 'upload';
  updatedAt: string;
}

const DATABASE = 'lingshu-presenter-onboarding';
const STORE = 'drafts';

function accountKey(): string {
  const token = getToken() || 'anonymous';
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `initial:${(hash >>> 0).toString(16)}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('人物资料草稿缓存不可用'));
  });
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      transaction.onerror = () => reject(transaction.error || new Error('人物资料草稿缓存失败'));
      action(transaction.objectStore(STORE), resolve, reject);
    });
  } finally {
    database.close();
  }
}

export async function loadPresenterOnboardingDraft(): Promise<PresenterOnboardingDraft | undefined> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return undefined;
  return transact<PresenterOnboardingDraft | undefined>('readonly', (store, resolve, reject) => {
    const request = store.get(accountKey());
    request.onsuccess = () => resolve(request.result as PresenterOnboardingDraft | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function savePresenterOnboardingDraft(draft: Omit<PresenterOnboardingDraft, 'updatedAt'>): Promise<void> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return;
  await transact<void>('readwrite', (store, resolve, reject) => {
    const request = store.put({ ...draft, updatedAt: new Date().toISOString() }, accountKey());
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearPresenterOnboardingDraft(): Promise<void> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return;
  await transact<void>('readwrite', (store, resolve, reject) => {
    const request = store.delete(accountKey());
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
