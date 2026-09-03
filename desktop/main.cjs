/* eslint-disable */
/**
 * Electron 主进程。
 * 加载工作台网页（默认指向本机 express，它同时服务 dist 静态页 + /api），
 * 并提供 render:start IPC：用本机原生 ffmpeg 合成成片，完成后在文件管理器中显示。
 */
const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { composite } = require('./render.cjs');

// Express 默认在 8788 同时提供 UI 与 API；DESKTOP_URL 可指向正式 HTTPS 域名。
const APP_URL = process.env.DESKTOP_URL || 'http://127.0.0.1:8788';
const APP_ORIGIN = trustedAppOrigin(APP_URL);

let win = null;

function trustedAppOrigin(value) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new Error('DESKTOP_URL must be a valid HTTP(S) URL'); }
  if (parsed.username || parsed.password || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('DESKTOP_URL must not contain credentials and must use HTTP(S)');
  }
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !loopback) {
    throw new Error('DESKTOP_URL must use HTTPS unless it targets loopback');
  }
  return parsed.origin;
}

function isTrustedNavigation(value) {
  try { return new URL(value).origin === APP_ORIGIN; }
  catch { return false; }
}

function allowedOutputRoots() {
  return [
    path.resolve(os.homedir(), 'Downloads', 'lingshu-ai-exports'),
    path.resolve(process.cwd(), 'data', 'publishing-uploads'),
  ];
}

function safeExistingOutputPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let resolved;
  try {
    resolved = fs.realpathSync(value);
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || path.extname(resolved).toLowerCase() !== '.mp4') return null;
  } catch { return null; }
  const contained = allowedOutputRoots().some(root => resolved === root || resolved.startsWith(`${root}${path.sep}`));
  return contained ? resolved : null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: '灵枢 AI 工作台',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: process.env.NODE_ENV !== 'production',
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, target) => {
    if (!isTrustedNavigation(target)) event.preventDefault();
  });
  void win.loadURL(APP_URL);
}

ipcMain.handle('render:start', async (_event, manifest) => {
  if (!_event.senderFrame || !isTrustedNavigation(_event.senderFrame.url)) {
    return { ok: false, error: 'render request origin is not trusted' };
  }
  const result = await composite(manifest, pct => {
    if (win && !win.isDestroyed()) win.webContents.send('render:progress', pct);
  }, undefined, {
    requireTimelineAssets: Boolean(manifest && manifest.requireTimelineAssets),
    maxTimelineAssets: 60,
    maxDownloadBytes: Math.max(1_000_000, Math.min(100 * 1024 * 1024, Number(process.env.RENDER_INLINE_ASSET_MAX_BYTES) || 25 * 1024 * 1024)),
    downloadTimeoutMs: Math.max(5_000, Math.min(120_000, Number(process.env.RENDER_DOWNLOAD_TIMEOUT_MS) || 45_000)),
  });
  // 合成成功后在系统文件管理器中高亮该文件，方便用户取片
  if (result.ok && result.outputPath) {
    shell.showItemInFolder(result.outputPath);
  }
  return result;
});

ipcMain.handle('file:showItemInFolder', async (_event, filePath) => {
  if (!_event.senderFrame || !isTrustedNavigation(_event.senderFrame.url)) return { ok: false, error: '请求来源不可信' };
  const safePath = safeExistingOutputPath(filePath);
  if (!safePath) return { ok: false, error: '只能打开工作台生成的 MP4 文件' };
  try {
    shell.showItemInFolder(safePath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || '打开本地文件夹失败' };
  }
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
