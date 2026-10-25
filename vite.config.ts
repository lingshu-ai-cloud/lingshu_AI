import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, type ServerOptions } from 'vite';
import { execFileSync } from 'node:child_process';

function resolveBuildSha() {
  const configured = String(process.env.VITE_APP_BUILD_SHA || process.env.APP_BUILD_SHA || '').trim();
  if (/^[a-f0-9]{7,64}$/i.test(configured)) return configured.toLowerCase();
  try {
    const value = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 2_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /^[a-f0-9]{7,64}$/i.test(value) ? value.toLowerCase() : 'unknown';
  } catch {
    return 'unknown';
  }
}

function resolveHmr(): ServerOptions['hmr'] {
  if (process.env.DISABLE_HMR === 'true') return false;
  const publicHost = process.env.DEV_HMR_HOST?.trim();
  if (publicHost) {
    const port = Number(process.env.DEV_HMR_PORT || 5177);
    const clientPort = Number(process.env.DEV_HMR_CLIENT_PORT || port);
    return { host: publicHost, port, clientPort };
  }
  return true;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devApiTarget = process.env.DEV_API_TARGET ?? env.DEV_API_TARGET ?? 'http://127.0.0.1:8790';
  const buildSha = resolveBuildSha();
  const devPort = Number(process.env.LINGSHU_PREVIEW_FRONTEND_PORT || process.env.DEV_PORT || 5177);

  return {
    // Multiple worktrees and baseline previews commonly run at the same time.
    // Keep each port's optimized dependency graph isolated so a neighboring
    // Vite process cannot invalidate this preview's versioned module URLs.
    cacheDir: path.resolve(import.meta.dirname, 'node_modules', `.vite-main-${devPort}`),
    plugins: [react(), tailwindcss()],
    define: { __APP_BUILD_SHA__: JSON.stringify(buildSha) },
    build: {
      rolldownOptions: {
        output: {
          // Keep reusable Studio support code cached separately from the large,
          // frequently changing workbench controller. Preserve execution order
          // because these modules remain static dependencies of that controller.
          strictExecutionOrder: true,
          codeSplitting: {
            groups: [{
              name: 'studio-workbench-views',
              test: /[\\/](?:StudioStepView|StudioLanguageSwitcherView|StudioProductionPanelView|StudioPropertyPanelView|StudioShotLibraryView|StudioProductionEditorView)\.tsx$/,
              includeDependenciesRecursively: false,
            }, {
              name: 'studio-support',
              // Views and the controller share these bindings. Keeping them out
              // of the page chunk prevents a generated views → page import.
              test: /[\\/](?:StudioWorkbenchFrame|StudioMediaPreviews|StudioPreviewStage|ShotSourceDecisionPanel|DigitalHumanProductionOverview|StudioOperationalEvidencePanel|studioSourceMaterial|studioLanguageRules|useStudioSocialTaskHydration|narrationTimeline|effectPlan|socialContentManualBridge|digitalHumanPlan|socialContentArtifactMedia|studioAuthenticatedMedia|frozenStudioProject|studioAutosave|storyboardRenderReadiness|personShotClustering|studioValidation|studioWorkspaceConfig|studioManagedPresenter|studioProjectNavigation|studioMediaProbes|studioWorkspaceCatalog|studioMaterialPresentation|studioStoryboardParsing|studioFontCatalog|studioScriptAdmission|studioReferenceVoiceProfile|studioScriptQualityPresentation|studioAsyncSupport|studioProductSelection|studioCloneReference|studioMaterialScriptEvidence|studioScriptSanitization|studioVoiceTranslation|studioLazyPanels|StudioFormPrimitives|studioFileInputs|studioSubtitleCues|studioStoryboardMaterialMatching|studioSocialShotIdentity|shotKeyframes|segmentEvidence|studioSocialTaskRead|voiceoverAlignment|studioVoiceoverRules|narrationAlignment|shootingReference)\.(?:ts|tsx)$|[\\/]lucide-react[\\/]dist[\\/]esm[\\/]icons[\\/](?:mic|heart|ellipsis|layout-panel-left|layout-grid|list-tree)\.m?js$/,
              includeDependenciesRecursively: false,
            }],
          },
        },
      },
    },
    // xlsx is installed from the vendored tarball. Vite 8 can invalidate its
    // optimized hash after the initial page graph has already been served,
    // making the default DigitalEmployeePage lazy import fail with a 504 and
    // leaving Safari on a white screen. Serve this ESM dependency directly.
    optimizeDeps: {
      exclude: ['xlsx'],
    },
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, 'src') },
    },
    server: {
    // Real AI runs on the server; preview browsers may only connect to this origin.
    ...((process.env.VITE_LINGSHU_LOCAL_PREVIEW ?? env.VITE_LINGSHU_LOCAL_PREVIEW) === '1' ? {headers: {'Content-Security-Policy': `connect-src 'self' ws://127.0.0.1:${process.env.DEV_HMR_CLIENT_PORT || devPort} ws://localhost:${process.env.DEV_HMR_CLIENT_PORT || devPort}; form-action 'self'`}} : {}),
    // 合并版使用独立端口，避免和 overseas / 新手引导两个工作区互相抢占。
    port: devPort,
    strictPort: true,
    host: '0.0.0.0',
    hmr: resolveHmr(),
    watch: {
      // 后端会在 data/ 下写入账号状态、token 用量、任务等运行时数据。
      // 这些文件变化不应触发前端整页 reload，否则新手任务会被反复卸载/挂载。
      ignored: ['**/data/**', '**/server/**', '**/dist*/**'],
    },
    proxy: {
      // 8788 被 Cursor 的 lingqi-ai 扩展占用；当前本地 watch 后端稳定监听 8790。
      '/api/overseas': {
        target: devApiTarget,
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      // 素材库 / BGM 曲库的文件由后端静态托管
      '/media': {
        target: devApiTarget,
        changeOrigin: true,
      },
      // Cloud/PocketBase material playback intentionally lives outside
      // `/api` so Safari media elements can stream it without custom headers.
      // Keep both historical and current routes on the same local backend;
      // otherwise Vite falls back to index.html and the video remains stuck in
      // the "preparing" state.
      '/cloud-files': {
        target: devApiTarget,
        changeOrigin: true,
      },
      '/studio-media': {
        target: devApiTarget,
        changeOrigin: true,
      },
      '/bgm': {
        target: devApiTarget,
        changeOrigin: true,
      },
      '/tts': {
        target: devApiTarget,
        changeOrigin: true,
      },
      '/covers': {
        target: devApiTarget,
        changeOrigin: true,
      },
    },
    },
  };
});
