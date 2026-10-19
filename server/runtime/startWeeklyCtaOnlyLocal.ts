/** Separate opt-in process. Validate all paths before importing storage modules,
 * whose local paths are captured at module initialization. */
import path from 'node:path';
import fs from 'node:fs';

const root = process.env.LOCAL_STORE_DIR;
const accounts = process.env.LOCAL_AUTH_ACCOUNTS_FILE;
const tenants = process.env.LOCAL_TENANTS_DATA_FILE;
const port = Number(process.env.WEEKLY_CTA_ONLY_PORT);
const objectRoot = process.env.LOCAL_OBJECT_STORAGE_ROOT;
const cardScope = [process.env.WEEKLY_CTA_ONLY_PROGRAM_ID, process.env.WEEKLY_CTA_ONLY_PACKAGE_ID,
  process.env.WEEKLY_CTA_ONLY_PACKAGE_VERSION, process.env.WEEKLY_CTA_ONLY_UI_DIR];
if (process.env.NODE_ENV === 'production' || process.env.ENABLE_LOCAL_DEV_FALLBACK !== 'true'
  || process.env.LINGSHU_LOCAL_PREVIEW !== '1'
  || !root || !accounts || !tenants || ![root, accounts, tenants].every(value => path.isAbsolute(value) && fs.existsSync(value))
  || process.env.OBJECT_STORAGE_DRIVER !== 'local' || !objectRoot || !path.isAbsolute(objectRoot) || !fs.existsSync(objectRoot)
  || !process.env.WEEKLY_CTA_ONLY_TENANT_ID || !process.env.WEEKLY_CTA_ONLY_USER_ID
  || !cardScope.slice(0, 3).every(Boolean)
  || !Number.isSafeInteger(port) || port < 1 || port > 65535)
  throw new Error('weekly_cta_local_configuration_required');
if (process.env.WEEKLY_CTA_ONLY_SESSION_ISSUER === '1'
  && (!cardScope.every(Boolean) || !process.env.WEEKLY_CTA_ONLY_UI_DIR
    || !path.isAbsolute(process.env.WEEKLY_CTA_ONLY_UI_DIR)
    || !fs.existsSync(path.join(process.env.WEEKLY_CTA_ONLY_UI_DIR, 'weekly-task-card.html'))))
  throw new Error('weekly_cta_local_task_card_required');

// The task card's material index lives with its explicitly selected local
// store. Never let a candidate upload fall through to repository data/.
const materialFile = process.env.MATERIAL_LIBRARY_FILE || path.join(root, 'materials.json');
if (!path.isAbsolute(materialFile) || fs.realpathSync(path.dirname(materialFile)) !== fs.realpathSync(root)
  || (fs.existsSync(materialFile) && path.dirname(fs.realpathSync(materialFile)) !== fs.realpathSync(root)))
  throw new Error('weekly_cta_local_material_library_scope_invalid');
process.env.MATERIAL_LIBRARY_FILE = materialFile;

// No loadEnvironment import: it can override an explicitly selected store.
const { createWeeklyCtaOnlyLocalApp, assertWeeklyCtaOnlyObjectStorage } = await import('./weeklyCtaOnlyLocalServer.js');
assertWeeklyCtaOnlyObjectStorage();
createWeeklyCtaOnlyLocalApp().listen(port, '127.0.0.1');
