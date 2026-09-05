import fs from 'node:fs';
import path from 'node:path';
import { enterpriseAssetTenantKey } from '../storage/enterpriseAssets.js';

export interface LocalE2ECleanupReport {
  tenantId: string;
  applied: boolean;
  backupDir: string;
  removedRecords: number;
  movedDirectories: string[];
  touchedFiles: Array<{ file: string; removed: number }>;
  verifiedClean: boolean;
  remainingReferences: string[];
}

const ROOT_ARRAY_FILES = [
  'data/materials.json',
  'data/studio-projects.json',
  'data/tasks.json',
  'data/whatsapp-customers.json',
  'data/whatsapp-interactions.json',
  'data/crawler-ops-queue.json',
  'data/local-auth-accounts.json',
  'data/local-auth-tenants.json',
] as const;

const ROOT_SINGLETON_FILES = [
  'data/whatsapp-import-status.json',
] as const;

function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown; } catch { return undefined; }
}

function containsTenantReference(value: unknown, tenantId: string): boolean {
  if (Array.isArray(value)) return value.some(item => containsTenantReference(item, tenantId));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => (
    ['tenantId', 'tenant_id'].includes(key) && String(item || '') === tenantId
  ) || containsTenantReference(item, tenantId));
}

function ownedArrayRow(row: unknown, tenantId: string, relative: string): boolean {
  if (!row || typeof row !== 'object') return false;
  const record = row as Record<string, unknown>;
  if (relative === 'data/local-auth-tenants.json' && String(record.id || '') === tenantId) return true;
  return containsTenantReference(record, tenantId);
}

function atomicWriteJson(file: string, value: unknown): void {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function localStoreFiles(root: string): string[] {
  const directory = path.join(root, 'data/local-store');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => path.join('data/local-store', name));
}

function tenantDirectories(root: string, tenantId: string): string[] {
  return [
    path.join(root, 'data/media/tenants', tenantId),
    path.join(root, 'data/tts/tenants', tenantId),
    path.join(root, 'data/covers/tenants', tenantId),
    path.join(root, 'data/publishing-uploads', tenantId),
    path.join(root, 'data/enterprise-assets', enterpriseAssetTenantKey(tenantId)),
  ];
}

function relativeBackupPath(relative: string): string {
  return relative.split(path.sep).join('__');
}

export function cleanupLocalE2ETenant(input: {
  root: string;
  tenantId: string;
  apply: boolean;
  now?: Date;
}): LocalE2ECleanupReport {
  const root = path.resolve(input.root);
  const tenantId = String(input.tenantId || '').trim();
  if (!/^local_tenant_customer_[a-f0-9]{32}$/i.test(tenantId)) {
    throw new Error('isolated_local_customer_tenant_required');
  }
  const stamp = (input.now || new Date()).toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(root, `data/backups/e2e-tenant-cleanup-${tenantId}-${stamp}`);
  const files = [...new Set([...localStoreFiles(root), ...ROOT_ARRAY_FILES])];
  const touchedFiles: LocalE2ECleanupReport['touchedFiles'] = [];
  let removedRecords = 0;

  for (const relative of files) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) continue;
    const parsed = readJson(file);
    if (!Array.isArray(parsed)) continue;
    const kept = parsed.filter(row => !ownedArrayRow(row, tenantId, relative));
    const removed = parsed.length - kept.length;
    if (!removed) continue;
    removedRecords += removed;
    touchedFiles.push({ file: relative, removed });
    if (input.apply) {
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(file, path.join(backupDir, relativeBackupPath(relative)));
      atomicWriteJson(file, kept);
    }
  }

  for (const relative of ROOT_SINGLETON_FILES) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) continue;
    const parsed = readJson(file);
    if (!containsTenantReference(parsed, tenantId)) continue;
    removedRecords += 1;
    touchedFiles.push({ file: relative, removed: 1 });
    if (input.apply) {
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(file, path.join(backupDir, relativeBackupPath(relative)));
      fs.rmSync(file, { force: true });
    }
  }

  const usageRelative = 'data/apify-video-usage.json';
  const usageFile = path.join(root, usageRelative);
  const usage = readJson(usageFile);
  if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
    const usageRecord = usage as Record<string, unknown>;
    const tenantMaps = Object.entries(usageRecord).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value));
    let removedUsageKeys = 0;
    const next = { ...usageRecord };
    for (const [key, value] of tenantMaps) {
      const map = { ...(value as Record<string, unknown>) };
      if (Object.prototype.hasOwnProperty.call(map, tenantId)) {
        delete map[tenantId];
        removedUsageKeys += 1;
        next[key] = map;
      }
    }
    if (removedUsageKeys) {
      removedRecords += removedUsageKeys;
      touchedFiles.push({ file: usageRelative, removed: removedUsageKeys });
      if (input.apply) {
        fs.mkdirSync(backupDir, { recursive: true });
        fs.copyFileSync(usageFile, path.join(backupDir, relativeBackupPath(usageRelative)));
        atomicWriteJson(usageFile, next);
      }
    }
  }

  const movedDirectories: string[] = [];
  for (const directory of tenantDirectories(root, tenantId)) {
    if (!fs.existsSync(directory)) continue;
    const relative = path.relative(root, directory);
    movedDirectories.push(relative);
    if (input.apply) {
      fs.mkdirSync(backupDir, { recursive: true });
      fs.renameSync(directory, path.join(backupDir, relativeBackupPath(relative)));
    }
  }

  const remainingReferences: string[] = [];
  if (input.apply) {
    for (const relative of files) {
      const file = path.join(root, relative);
      const parsed = readJson(file);
      if (Array.isArray(parsed) && parsed.some(row => ownedArrayRow(row, tenantId, relative))) remainingReferences.push(relative);
    }
    for (const relative of ROOT_SINGLETON_FILES) {
      const parsed = readJson(path.join(root, relative));
      if (containsTenantReference(parsed, tenantId)) remainingReferences.push(relative);
    }
    const currentUsage = readJson(usageFile);
    if (currentUsage && typeof currentUsage === 'object' && JSON.stringify(currentUsage).includes(tenantId)) remainingReferences.push(usageRelative);
    for (const directory of tenantDirectories(root, tenantId)) {
      if (fs.existsSync(directory)) remainingReferences.push(path.relative(root, directory));
    }
  }

  return {
    tenantId,
    applied: input.apply,
    backupDir: input.apply && (touchedFiles.length || movedDirectories.length) ? backupDir : '',
    removedRecords,
    movedDirectories,
    touchedFiles,
    verifiedClean: input.apply ? remainingReferences.length === 0 : false,
    remainingReferences,
  };
}
