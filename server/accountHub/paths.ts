import path from 'node:path';

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export interface AccountPaths {
  dataDir: string;
  accountRoot: string;
  profileDir: string;
}

/** Resolve the only directory in which account-hub state may be created. */
export function resolveAccountHubDataDir(configured = process.env.ACCOUNT_HUB_DATA_DIR): string {
  const value = configured?.trim();
  if (value) {
    if (!path.isAbsolute(value)) {
      throw new Error('ACCOUNT_HUB_DATA_DIR must be an absolute path');
    }
    return path.resolve(value);
  }
  return path.resolve(process.cwd(), 'data', 'account-hub');
}

export function assertValidAccountId(accountId: string): void {
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error('Invalid account id: use 1-80 ASCII letters, numbers, underscores, or hyphens');
  }
}

function assertDescendant(parent: string, candidate: string): void {
  const relative = path.relative(parent, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Account path escapes its storage root');
  }
}

export function getAccountPaths(accountId: string, configuredDataDir?: string): AccountPaths {
  assertValidAccountId(accountId);
  const dataDir = resolveAccountHubDataDir(configuredDataDir);
  const accountsRoot = path.resolve(dataDir, 'accounts');
  const accountRoot = path.resolve(accountsRoot, accountId);
  assertDescendant(accountsRoot, accountRoot);
  return {
    dataDir,
    accountRoot,
    profileDir: path.join(accountRoot, 'profile'),
  };
}
