import dotenv from 'dotenv';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function loadEnvironment() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const [index, file] of [path.join(root, '.env'), path.join(os.homedir(), '.config/lingshu-ai/.env'), path.join(os.homedir(), '.config/lingshu-ai/.env.local'), path.join(root, '.env.local')].entries()) {
    dotenv.config({ path: file, override: index === 3, quiet: true });
  }
}
loadEnvironment();
