import { createContext } from 'react';
import type { AdDirectoryAccount } from '../../shared/adAccountDirectory';
export type DirectoryContext = {
  items: AdDirectoryAccount[]; selected?: AdDirectoryAccount; select: (key: string) => void;
  loading: boolean; error: string; warnings: string[]; refresh: () => void;
  adId: string; openCreative: (adId: string) => void;
};
// Keep context identity separate from hot-reloaded provider and visual controls.
export const AdAccountDirectoryContext = createContext<DirectoryContext | null>(null);
