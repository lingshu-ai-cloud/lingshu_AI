import { buildVideoDownloaderArgs } from '../routes/videoDownloaderArgs.js';
import { browserUserAgent, cookieBrowsers, cookieFiles, cookiesBrowser } from '../routes/videoCrawlerRuntimeConfig.js';
import { DownloadBudget, terminalDownloadFailure } from '../lib/downloadExecution.js';
import { createVideoDownloaderPythonResolver } from '../lib/videoDownloaderPython.js';
import { execFileAsync } from './runtimeConfig.js';
import type { VideoApplicationPorts } from './applicationPorts.js';

export function createVideoDownloaderTransport(deps: Pick<VideoApplicationPorts, 'proxyUrl' | 'crawlerExecEnv'>) {
  const proxyUrl: VideoApplicationPorts['proxyUrl'] = (...args) => deps.proxyUrl(...args);
  const crawlerExecEnv: VideoApplicationPorts['crawlerExecEnv'] = (...args) => deps.crawlerExecEnv(...args);

  const ytDlpPythonPath = createVideoDownloaderPythonResolver();

  function buildYtDlpArgs(extra: string[], url: string, withCookies: boolean): string[] {
    return buildVideoDownloaderArgs(extra, url, withCookies, {
      userAgent: browserUserAgent(), proxy: proxyUrl(), cookiesBrowser: cookiesBrowser(),
      nodeExecutable: process.execPath, youtubeEjsEnabled: process.env.YT_DLP_YOUTUBE_EJS_ENABLED !== '0',
    });
  }

  async function execYtDlpWithCookieFallback(extra: string[], url: string, timeout: number, maxBuffer: number, budget = new DownloadBudget(timeout)): Promise<string> {
    let lastError: unknown = null;
    for (const cookieFile of cookieFiles()) {
      try {
        const args = buildYtDlpArgs(extra, url, false);
        const proxy = proxyUrl();
        const insertAt = proxy ? args.indexOf('--proxy') : args.length - 1;
        args.splice(insertAt, 0, '--cookies', cookieFile);
        const { stdout } = await execFileAsync(ytDlpPythonPath(), args, { maxBuffer, timeout: budget.remaining(), env: crawlerExecEnv() });
        return stdout;
      } catch (e) {
        lastError = e;
        budget.record('cookie-file', e);
        if (terminalDownloadFailure(e)) throw budget.error();
      }
    }
    const browsers = cookieBrowsers();
    if (browsers.length === 0) {
      if (lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError));
      throw new Error('需要平台登录态，但本机没有可读取的浏览器 cookies。请先配置 YT_DLP_COOKIE_FILES，或在 Safari/Chrome 登录对应平台并设置 YT_DLP_COOKIES_BROWSER。');
    }
    for (const browser of browsers) {
      try {
        const args = buildYtDlpArgs(extra, url, false);
        const proxy = proxyUrl();
        const insertAt = proxy ? args.indexOf('--proxy') : args.length - 1;
        args.splice(insertAt, 0, '--cookies-from-browser', browser);
        const { stdout } = await execFileAsync(ytDlpPythonPath(), args, { maxBuffer, timeout: budget.remaining(), env: crawlerExecEnv() });
        return stdout;
      } catch (e) {
        lastError = e;
        budget.record(browser, e);
        if (terminalDownloadFailure(e)) throw budget.error();
      }
    }
    throw budget.error('yt-dlp cookie fallback failed');
  }

  return { ytDlpPythonPath, buildYtDlpArgs, execYtDlpWithCookieFallback };
}
