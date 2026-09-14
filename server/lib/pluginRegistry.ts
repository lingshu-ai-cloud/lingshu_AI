import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type PluginCategory = 'ecommerce' | 'social' | 'tool' | 'ai';
export type PluginStatus = 'installed' | 'not_installed' | 'error';

export interface StoredPlugin {
  id: string;
  pluginKey: string;
  name: string;
  nameZh: string;
  category: PluginCategory;
  description: string;
  icon: string;
  status: PluginStatus;
  config: Record<string, string>;
  installedAt?: string;
}

export class PluginRegistryUnavailableError extends Error {
  readonly code = 'plugin_registry_unavailable';

  constructor(cause?: unknown) {
    super('plugin registry unavailable', { cause });
    this.name = 'PluginRegistryUnavailableError';
  }
}

const categories = new Set<PluginCategory>(['ecommerce', 'social', 'tool', 'ai']);
const statuses = new Set<PluginStatus>(['installed', 'not_installed', 'error']);
const allowedKeys = new Set(['id', 'pluginKey', 'name', 'nameZh', 'category', 'description', 'icon', 'status', 'config', 'installedAt']);
const mutationQueues = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStoredPlugin(value: unknown): value is StoredPlugin {
  if (!isRecord(value) || !isRecord(value.config)) return false;
  const requiredStrings = ['id', 'pluginKey', 'name', 'nameZh', 'description', 'icon'] as const;
  return Object.keys(value).every(key => allowedKeys.has(key))
    && requiredStrings.every(key => typeof value[key] === 'string' && value[key].length > 0)
    && categories.has(value.category as PluginCategory)
    && statuses.has(value.status as PluginStatus)
    && Object.values(value.config).every(item => typeof item === 'string')
    && (value.installedAt === undefined || typeof value.installedAt === 'string');
}

function unavailable(error: unknown): PluginRegistryUnavailableError {
  return error instanceof PluginRegistryUnavailableError ? error : new PluginRegistryUnavailableError(error);
}

export function readPluginRegistry(filePath: string): StoredPlugin[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw unavailable(error);
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isStoredPlugin)) throw new Error('invalid plugin registry schema');
    if (new Set(parsed.map(plugin => plugin.id)).size !== parsed.length
      || new Set(parsed.map(plugin => plugin.pluginKey)).size !== parsed.length) {
      throw new Error('duplicate plugin registry identity');
    }
    return parsed;
  } catch (error) {
    throw unavailable(error);
  }
}

function writePluginRegistry(filePath: string, plugins: StoredPlugin[]): void {
  if (!plugins.every(isStoredPlugin)) throw unavailable(new Error('invalid plugin registry schema'));
  const directory = path.dirname(filePath);
  const temporaryFile = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    descriptor = fs.openSync(temporaryFile, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(plugins, null, 2), 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.chmodSync(temporaryFile, 0o600);
    fs.renameSync(temporaryFile, filePath);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* best-effort cleanup */ }
    }
    try { fs.unlinkSync(temporaryFile); } catch { /* best-effort cleanup */ }
    throw unavailable(error);
  }
}

export async function mutatePluginRegistry<T>(
  filePath: string,
  mutation: (plugins: StoredPlugin[]) => { plugins: StoredPlugin[]; result: T },
): Promise<T> {
  const previous = mutationQueues.get(filePath) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(() => {
    const { plugins, result } = mutation(readPluginRegistry(filePath));
    writePluginRegistry(filePath, plugins);
    return result;
  });
  const tail = operation.then(() => undefined, () => undefined);
  mutationQueues.set(filePath, tail);
  try {
    return await operation;
  } catch (error) {
    throw unavailable(error);
  } finally {
    if (mutationQueues.get(filePath) === tail) mutationQueues.delete(filePath);
  }
}
