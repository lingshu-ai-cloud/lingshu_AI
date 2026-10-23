import { useEffect, useRef, useState } from 'react';
import { studioApi, getDesktopRender, type RenderSpec } from '../../lib/studioApi';
import type { LanguageRenderOutput, LanguageRenderGeneration } from './studioWorkspaceContracts';

export interface StudioRenderRequest {
  outputOnly?: boolean;
  serverPreviewRequired?: boolean;
  outputKey?: string;
  inputSignature?: string;
  freeThreeStep: boolean;
  productionSignature: string;
  resolveProjectId(): string | null;
  defaultOutputKey(language: string): string;
  cover: Parameters<typeof studioApi.cover>[0] | null;
  onCover(url: string | null): void;
  onNotice(message: string): void;
  prepareSpec(coverUrl: string | null): { spec: RenderSpec; outputLanguage: string };
}

function useStudioRenderState() {
  const [renderProductionSignatures, setRenderProductionSignatures] = useState<Record<string, string>>({});
  const [rendering, setRendering] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [renderPct, setRenderPct] = useState(0);
  const [renderOutputPath, setRenderOutputPath] = useState<string | null>(null); // 桌面端合成产物路径
  const [renderOutputPreviewUrl, setRenderOutputPreviewUrl] = useState<string | null>(null);
  const [languageRenderOutputs, setLanguageRenderOutputs] = useState<Record<string, LanguageRenderOutput>>({});
  const [languageRenderVersions, setLanguageRenderVersions] = useState<Record<string, LanguageRenderGeneration[]>>({});
  const [activeRenderCombinationKey, setActiveRenderCombinationKey] = useState('');
  const [batchRenderingLangs, setBatchRenderingLangs] = useState(false);
  const renderToken = useRef(0); // 取消过期的渲染循环（重复点「重新合成」时）
  const renderPreviewUrlsRef = useRef<Record<string, string>>({});
  return {
    renderProductionSignatures, setRenderProductionSignatures, rendering, setRendering,
    rendered, setRendered, renderPct, setRenderPct,
    renderOutputPath, setRenderOutputPath, renderOutputPreviewUrl, setRenderOutputPreviewUrl,
    languageRenderOutputs, setLanguageRenderOutputs, languageRenderVersions, setLanguageRenderVersions,
    activeRenderCombinationKey, setActiveRenderCombinationKey, batchRenderingLangs, setBatchRenderingLangs,
    renderToken, renderPreviewUrlsRef,
  };
}

/** Owns submission, progress, obsolete-result guards and all output writeback. */
export function createStudioRenderActions(state: ReturnType<typeof useStudioRenderState>) {
  const {
    setRenderProductionSignatures, setRendering, setRendered, setRenderPct,
    setRenderOutputPath, setRenderOutputPreviewUrl, setLanguageRenderOutputs,
    setLanguageRenderVersions, setActiveRenderCombinationKey, setBatchRenderingLangs,
    renderToken, renderPreviewUrlsRef,
  } = state;
  const render = async (request: StudioRenderRequest) => {
    setRendered(false);
    setRendering(true);
    setRenderPct(0);
    if (!request.outputOnly) {
      setRenderOutputPath(null);
      setRenderOutputPreviewUrl(null);
    }
    const token = ++renderToken.current;
    try {
      const cv = request.cover
        ? await studioApi.cover(request.cover)
        : { ok: false as const, url: null };
      if (renderToken.current !== token) return;
      const cUrl = cv.ok ? (cv.url ?? null) : null;
      request.onCover(cUrl);

      const { spec, outputLanguage } = request.prepareSpec(cUrl);
      // Electron 保留短期授权 + 本机桥；浏览器自由创作直接建立持久任务，避免重复扣减额度。
      const desktop = getDesktopRender();
      const auth = desktop?.available || !request.freeThreeStep ? await studioApi.render(spec) : null;

      // 2) 桌面客户端：用本机原生 ffmpeg 真实合成出片
      if (desktop?.available && !request.serverPreviewRequired) {
        const unsub = desktop.onProgress(p => {
          if (renderToken.current === token) setRenderPct(Math.min(99, Math.round(p)));
        });
        try {
          const out = await desktop.render(auth!.manifest);
          if (renderToken.current !== token) return;
          if (out.ok) {
            if (out.outputPath) setRenderProductionSignatures(current => ({ ...current, [out.outputPath!]: request.productionSignature }));
            if (!request.outputOnly) setRenderOutputPath(out.outputPath ?? null);
            setRendering(false);
            setRendered(true);
            setRenderPct(100);
            return out.outputPath ?? null;
          } else {
            setRendering(false);
            setRendered(false);
            throw new Error(out.error || '桌面端合成失败');
          }
        } finally {
          unsub();
        }
        return;
      }

      // 3) 浏览器自由创作使用服务端持久任务：刷新、断网或服务重启后可从项目恢复。
      if (request.freeThreeStep) {
        const persistedProjectId = request.resolveProjectId();
        if (!persistedProjectId) throw new Error('请先保存自由创作草稿，再开始成片渲染');
        const outputKey = request.outputKey || request.defaultOutputKey(outputLanguage);
        const inputSignature = request.inputSignature || request.productionSignature;
        const created = await studioApi.createRenderJob({ projectId: persistedProjectId, outputKey, inputSignature, spec });
        if (!created.ok || !created.job) throw new Error(created.error || '渲染任务创建失败');
        let job = created.job;
        while (job.status === 'queued' || job.status === 'processing') {
          if (renderToken.current !== token) return null;
          setRenderPct(Math.max(5, Math.min(99, job.progress || 15)));
          await new Promise(resolve => window.setTimeout(resolve, 1200));
          const latest = await studioApi.latestRenderJob(persistedProjectId);
          if (!latest.ok || !latest.job) throw new Error(latest.error || '渲染任务状态暂时不可用');
          job = latest.job;
        }
        if (job.status !== 'completed' || !job.outputPath) throw new Error(job.error || '本地 MP4 导出失败');
        const localOut = { ok: true, outputPath: job.outputPath, previewUrl: job.previewUrl };
        if (renderToken.current !== token) return null;
        if (localOut.outputPath) setRenderProductionSignatures(current => ({ ...current, [localOut.outputPath!]: inputSignature }));
        if (localOut.outputPath && localOut.previewUrl) renderPreviewUrlsRef.current[localOut.outputPath] = localOut.previewUrl;
        if (!request.outputOnly) { setRenderOutputPath(localOut.outputPath); setRenderOutputPreviewUrl(localOut.previewUrl || null); }
        setRendering(false); setRendered(true); setRenderPct(100);
        return localOut.outputPath;
      }

      // 4) 其他网页工作流继续使用原有同步本机渲染，避免影响爆款复刻。
      setRenderPct(20);
      const progressTimer = window.setInterval(() => {
        if (renderToken.current !== token) return;
        setRenderPct(current => Math.min(90, current + (current < 60 ? 6 : 2)));
      }, 1200);
      const localOut = await studioApi.renderLocal(auth!.manifest, auth!.token).finally(() => window.clearInterval(progressTimer));
      if (renderToken.current !== token) return;
      if (!localOut.ok) throw new Error(localOut.error || '本地 MP4 导出失败');
      if (localOut.outputPath) setRenderProductionSignatures(current => ({ ...current, [localOut.outputPath!]: request.productionSignature }));
      if (localOut.outputPath && localOut.previewUrl) renderPreviewUrlsRef.current[localOut.outputPath] = localOut.previewUrl;
      if (!request.outputOnly) {
        setRenderOutputPath(localOut.outputPath ?? null);
        setRenderOutputPreviewUrl(localOut.previewUrl ?? null);
      }
      setRendering(false);
      setRendered(true);
      setRenderPct(100);
      return localOut.outputPath ?? null;
    } catch (err: any) {
      if (renderToken.current === token) {
        setRendering(false);
        setRendered(false);
        request.onNotice('成片渲染失败，请重试。');
      }
      throw err;
    }
  };
  const renderVersion = async (request: {
    key: string; inputSignature: string; onNotice(message: string): void;
    render(): Promise<string | null | undefined>;
  }) => {
    setBatchRenderingLangs(true);
    setActiveRenderCombinationKey(request.key);
    setLanguageRenderOutputs(prev => ({ ...prev, [request.key]: { status: 'rendering' } }));
    try {
      const key = request.key;
      const outputPath = await request.render();
      if (!outputPath) throw new Error('成片渲染未返回文件，请重试当前版本');
      const previewUrl = outputPath ? renderPreviewUrlsRef.current[outputPath] : undefined;
      setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'done', path: outputPath, previewUrl, inputSignature: request.inputSignature } }));
      setLanguageRenderVersions(prev => ({ ...prev, [key]: [{ id: `${key}-${Date.now()}`, versionNumber: (prev[key]?.[0]?.versionNumber || 0) + 1, status: 'done', path: outputPath, previewUrl, inputSignature: request.inputSignature, createdAt: new Date().toISOString() }, ...(prev[key] || [])] }));
    } catch (err: any) {
      request.onNotice(err?.message || '成片渲染失败，请重试。');
      const key = request.key;
      setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'failed', error: err?.message || '生成失败' } }));
      setLanguageRenderVersions(prev => ({ ...prev, [key]: [{ id: `${key}-${Date.now()}`, versionNumber: (prev[key]?.[0]?.versionNumber || 0) + 1, status: 'failed', error: err?.message || '生成失败', createdAt: new Date().toISOString() }, ...(prev[key] || [])] }));
    } finally {
      setBatchRenderingLangs(false);
    }
  };
  const recover = (input: { projectId: string; onNotice(message: string): void }) => {
    let disposed = false;
    let timer = 0;
    const refresh = async () => {
      const result = await studioApi.latestRenderJob(input.projectId);
      if (disposed || !result.ok || !result.job) return;
      const job = result.job;
      if (job.status === 'queued' || job.status === 'processing') {
        setRendering(true); setRendered(false); setRenderPct(Math.max(5, Math.min(99, job.progress || 15)));
        setLanguageRenderOutputs(current => ({ ...current, [job.outputKey]: { status: 'rendering' } }));
        timer = window.setTimeout(refresh, 1800);
        return;
      }
      setRendering(false);
      if (job.status === 'completed' && job.outputPath) {
        setRendered(true); setRenderPct(100); setRenderOutputPath(job.outputPath);
        setRenderOutputPreviewUrl(job.previewUrl || null);
        renderPreviewUrlsRef.current[job.outputPath] = job.previewUrl || '';
        setRenderProductionSignatures(current => ({ ...current, [job.outputPath!]: job.inputSignature }));
        setLanguageRenderOutputs(current => ({ ...current, [job.outputKey]: {
            status: 'done', path: job.outputPath, previewUrl: job.previewUrl, inputSignature: job.inputSignature } }));
      } else if (job.status === 'failed') {
        setRendered(false);
        setLanguageRenderOutputs(current => ({ ...current, [job.outputKey]: { status: 'failed', error: job.error || '生成失败' } }));
        input.onNotice(`成片渲染中断：${job.error || '请重试当前版本'}`);
      }
    };
    return { refresh, dispose: () => { disposed = true; if (timer) window.clearTimeout(timer); } };
  };
  return { render, renderVersion, recover };
}

export function useStudioRenderSession() {
  const state = useStudioRenderState();
  const { renderToken, renderPreviewUrlsRef, ...snapshot } = state;
  return { ...snapshot, ...createStudioRenderActions(state) };
}

export function useStudioRenderRecovery(session: ReturnType<typeof useStudioRenderSession>, input: {
  enabled: boolean; projectId: string | null; onNotice(message: string): void;
}) {
  const { enabled, projectId } = input;
  useEffect(() => {
    if (!enabled || !projectId || getDesktopRender()?.available) return;
    const recovery = session.recover({ projectId, onNotice: input.onNotice });
    void recovery.refresh();
    return recovery.dispose;
  }, [enabled, projectId]);
}
