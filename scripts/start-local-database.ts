import '../server/loadEnvironment.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
const url = new URL(process.env.PB_URL || 'http://127.0.0.1:8091');
if (process.env.NODE_ENV === 'production' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw Error('此命令仅启动本机开发数据库，拒绝操作远端或生产环境');
const healthy = async () => { try { return (await fetch(new URL('/api/health', url), { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } };
if (await healthy()) { console.log('本机素材数据库已就绪'); process.exit(0); }
const bin = process.env.PB_BIN || path.join(os.homedir(), '.local/share/lingshu/pocketbase/pocketbase');
const dir = process.env.PB_DATA_DIR || path.join(os.homedir(), '.local/share/lingshu/pocketbase/data');
if (!fs.existsSync(bin)) throw Error('缺少本机 PocketBase 可执行文件，请配置 PB_BIN');
const fresh = !fs.existsSync(path.join(dir, 'data.db'));
fs.mkdirSync(dir, { recursive: true });
if (fresh) {
  if (!process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) throw Error('请先配置本机数据库管理员凭证');
  try { execFileSync(bin, ['superuser','upsert',process.env.PB_ADMIN_EMAIL,process.env.PB_ADMIN_PASSWORD,`--dir=${dir}`], { stdio: 'ignore', timeout: 15000 }); }
  catch { throw Error('本机数据库管理员初始化失败；未输出凭证'); }
}
const log = fs.openSync(path.join(dir, 'server.log'), 'a', 0o600);
const child = spawn(bin, ['serve',`--http=127.0.0.1:${url.port || 8090}`,`--dir=${dir}`], { cwd: path.dirname(bin), detached: true, stdio: ['ignore',log,log] });
child.unref(); fs.closeSync(log);
for (let attempt=0;attempt<30;attempt++) { if (await healthy()) { console.log(JSON.stringify({ ready:true, fresh, url:url.origin, dataDir:dir })); process.exit(0); } await new Promise(resolve=>setTimeout(resolve,300)); }
throw Error('本机数据库未启动，请检查其 server.log');
