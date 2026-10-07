import '../server/loadEnvironment.js';
import { objectStorageDriver, objectStorageList, type StoredObjectSummary } from '../server/storage/objectStorage.js';

function option(name: string): string {
  const inline = process.argv.find(value => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '') : '';
}

const prefix = option('--prefix').replace(/^\/+/, '');
const maxObjects = Math.max(1, Math.min(1_000_000, Number(option('--max-objects') || 100_000)));
const objects: StoredObjectSummary[] = [];
let cursor: string | undefined;
do {
  const page = await objectStorageList({ prefix, cursor, limit: Math.min(1_000, maxObjects - objects.length) });
  objects.push(...page.items);
  cursor = page.cursor;
} while (cursor && objects.length < maxObjects);

const groups = new Map<string, { objects: number; bytes: number }>();
for (const object of objects) {
  const group = object.key.split('/', 1)[0] || '(root)';
  const current = groups.get(group) || { objects: 0, bytes: 0 };
  current.objects += 1;
  current.bytes += object.size;
  groups.set(group, current);
}
const largest = [...objects].sort((a, b) => b.size - a.size).slice(0, 20).map(object => ({
  key: object.key,
  bytes: object.size,
  lastModified: object.lastModified?.toISOString(),
}));
process.stdout.write(`${JSON.stringify({
  mode: 'read_only_inventory',
  driver: objectStorageDriver(),
  prefix: prefix || '/',
  truncated: Boolean(cursor),
  objects: objects.length,
  bytes: objects.reduce((sum, object) => sum + object.size, 0),
  groups: Object.fromEntries([...groups.entries()].sort((a, b) => b[1].bytes - a[1].bytes)),
  largest,
}, null, 2)}\n`);
