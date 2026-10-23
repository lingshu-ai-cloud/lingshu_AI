import { useState } from 'react';
import { showActionFeedback } from '../../lib/actionFeedback';
import { authHeader } from '../../lib/auth';
import type { GeminiVideoAnalysis, TrendVideo, VideoAnalysisPayload } from '../../lib/inspirationTypes';
import { imagePostAnalysisQueuePresentation } from './imagePostAnalysisPresentation';
import { type StateSetter } from './inspirationDashboardContracts';
import { pauseExactAnalysis, readExactAnalysisRecord, submitExactAnalysis } from './inspirationExactAnalysisApi';
import type { useInspirationDiscoveryInventory } from './useInspirationDiscoveryInventory';
import { analysisProgressIsActive } from './VideoAnalysisProgressPanel';

interface Dependencies extends Pick<ReturnType<typeof useInspirationDiscoveryInventory>, 'refreshVideos' | 'setCrawledVideos' | 'videoPage'> {
  setMaterialMessage: StateSetter<string>;
  setSelectedVideo: StateSetter<TrendVideo | null>;
  setWatchVideo: StateSetter<TrendVideo | null>;
}

export function useInspirationAnalysis({ setMaterialMessage, refreshVideos, setCrawledVideos, setSelectedVideo, setWatchVideo, videoPage }: Dependencies) {
  const [analyzingVideoIds, setAnalyzingVideoIds] = useState<string[]>([]);

  const analyzeVideoOnly = async (video: TrendVideo, quiet = false) => {
    if (!video.sourceUrl || analyzingVideoIds.includes(video.id)) return;
    setAnalyzingVideoIds(ids => [...ids, video.id]);
    if (!quiet) setMaterialMessage('');
    try {
      const r = await fetch('/api/overseas/videos/analyze-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          id: video.recordId,
          sourceUrl: video.sourceUrl,
          title: video.title,
          platform: video.platform,
          async: true,
        }),
      });
      const data = await r.json().catch(() => ({})) as {
        error?: string;
        analysis?: GeminiVideoAnalysis;
      };
      if (!r.ok) throw new Error(data.error || '视频分析失败');
      if (r.status === 202) {
        setMaterialMessage(`已加入视频获取队列，获取成功后自动进入 Gemini 分析：${video.title}`);
        setTimeout(() => setMaterialMessage(''), 3500);
        void refreshVideos();
        return;
      }
      const updated: TrendVideo = {
        ...video,
        status: 'analyzed',
        aiAnalysis: {
          ...(video.aiAnalysis || {}),
          gemini: data.analysis,
          analysisSource: 'gemini-temp-video',
          downloadStatus: 'analyzed',
          analyzedAt: new Date().toISOString(),
        },
      };
      setCrawledVideos(prev => prev.map(v => v.id === video.id ? updated : v));
      setSelectedVideo(v => v?.id === video.id ? updated : v);
      setWatchVideo(v => v?.id === video.id ? updated : v);
      setMaterialMessage(`Gemini 分析完成：${video.title}`);
      setTimeout(() => setMaterialMessage(''), 3500);
    } catch (e) {
      if (!quiet) setMaterialMessage(e instanceof Error ? e.message : '视频分析失败');
    } finally {
      setAnalyzingVideoIds(ids => ids.filter(id => id !== video.id));
    }
  };

  const retryVideoPipeline = async (video: TrendVideo) => {
    if (video.recordId) {
      setMaterialMessage(`已重新提交 Gemini 分析：${video.title}`);
      try {
        const r = await fetch(`/api/overseas/videos/${video.recordId}/reanalyze`, {
          method: 'PATCH',
          headers: authHeader(),
        });
        const data = await r.json().catch(() => ({})) as { error?: string };
        if (!r.ok) throw new Error(data.error || '重新分析失败');
        void refreshVideos();
      } catch (e) {
        setMaterialMessage(e instanceof Error ? e.message : '重新分析失败');
      }
      setTimeout(() => setMaterialMessage(''), 3500);
      return;
    }
    await analyzeVideoOnly(video);
  };

  const reanalyzeImagePost = async (video: TrendVideo) => {
    const queued = imagePostAnalysisQueuePresentation(video);
    if (queued) { setMaterialMessage(queued.detail); return; }
    const recordId = video.recordId || video.id.replace(/^crawl-/, '');
    if (!recordId || analyzingVideoIds.includes(video.id)) return;
    setAnalyzingVideoIds(ids => [...ids, video.id]);
    setMaterialMessage(`正在重新分析图文证据：${video.title}`);
    try {
      const response = await fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/reanalyze-image`, {
        method: 'POST',
        headers: authHeader(),
      });
      const data = await response.json().catch(() => ({})) as {
        error?: string;
        analysis?: NonNullable<VideoAnalysisPayload['imageEvidence']>;
      };
      if (!response.ok || !data.analysis) throw new Error(data.error || '图文证据分析失败');
      const markAnalyzed = (item: TrendVideo): TrendVideo => item.id !== video.id ? item : {
        ...item,
        status: 'analyzed',
        aiAnalysis: {
          ...(item.aiAnalysis || {}),
          imageEvidence: data.analysis,
          imageAnalysisStatus: 'analyzed',
          imageAnalysisError: undefined,
          analysisError: undefined,
          analyzedAt: new Date().toISOString(),
        },
      };
      setCrawledVideos(items => items.map(markAnalyzed));
      setSelectedVideo(item => item ? markAnalyzed(item) : item);
      setWatchVideo(item => item ? markAnalyzed(item) : item);
      setMaterialMessage('图文证据分析已完成，可以开始创作。');
      await refreshVideos(videoPage, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : '图文证据分析失败';
      setMaterialMessage(message);
      showActionFeedback({ title: '图文分析失败', description: message, tone: 'error' });
      await refreshVideos(videoPage, true);
    } finally {
      setAnalyzingVideoIds(ids => ids.filter(id => id !== video.id));
      window.setTimeout(() => setMaterialMessage(''), 3500);
    }
  };

  const requestExactFullAnalysis = async (video: TrendVideo, force = false) => {
    if (analyzingVideoIds.includes(video.id)) return;
    const materialId = video.id.startsWith('material-') ? video.id.slice('material-'.length) : '';
    if (!video.recordId && !materialId) {
      setMaterialMessage('当前视频缺少可分析的入库记录或素材文件');
      return;
    }
    setAnalyzingVideoIds(ids => [...ids, video.id]);
    setMaterialMessage(`正在提交全片精确分析：${video.title}`);
    try {
      const data = await submitExactAnalysis(video, force);
      if (data.status === 'analyzed') {
        const markCompleted = (item: TrendVideo): TrendVideo => ({
          ...item,
          status: 'analyzed',
          aiAnalysis: { ...(item.aiAnalysis || {}), analysisMode: 'exact', requestedAnalysisMode: undefined },
        });
        setCrawledVideos(items => items.map(item => item.id === video.id ? markCompleted(item) : item));
        setSelectedVideo(item => item?.id === video.id ? markCompleted(item) : item);
        setMaterialMessage(data.reused ? '现有全片拆解已达到精确密度，已升级为全片精确分析版。' : '全片精确分析已完成。');
        return;
      }
      const markQueued = (item: TrendVideo): TrendVideo => ({
        ...item,
        recordId: data.id || item.recordId,
        status: 'pending',
        aiAnalysis: {
          ...(item.aiAnalysis || {}),
          analysisProgress: undefined,
          requestedAnalysisMode: 'exact',
          geminiStatus: 'queued',
          analysisError: undefined,
          videoLevelFailureStatus: undefined,
        },
      });
      setCrawledVideos(items => items.map(item => item.id === video.id ? markQueued(item) : item));
      setSelectedVideo(item => item?.id === video.id ? markQueued(item) : item);
      const recordId = data.id || video.recordId;
      if (recordId) {
        void (async () => {
          let completed = false;
          for (let attempt = 0; attempt < 90; attempt += 1) {
            await new Promise(resolve => window.setTimeout(resolve, 2000));
            try {
              const latest = await readExactAnalysisRecord(recordId);
              if (!latest) continue;
              let latestAnalysis: VideoAnalysisPayload = {};
              try { latestAnalysis = JSON.parse(latest.aiAnalysis || '{}') as VideoAnalysisPayload; } catch {}
              const applyLatest = (item: TrendVideo): TrendVideo => item.id !== video.id ? item : {
                ...item,
                recordId,
                status: latest.status || item.status,
                aiAnalysis: { ...(item.aiAnalysis || {}), ...latestAnalysis },
              };
              setCrawledVideos(items => items.map(applyLatest));
              setSelectedVideo(item => item ? applyLatest(item) : item);
              const progressFinished = Boolean(latestAnalysis.analysisProgress)
                && !analysisProgressIsActive(latestAnalysis.analysisProgress);
              if (!latestAnalysis.requestedAnalysisMode || progressFinished) {
                completed = true;
                setMaterialMessage(latestAnalysis.analysisError || latestAnalysis.analysisProgress?.stage === 'failed'
                  ? `全片精确分析未完成，可重新尝试。`
                  : '全片精确分析已完成。');
                window.setTimeout(() => setMaterialMessage(''), 3500);
                break;
              }
            } catch {
              // A transient backend reload should not lose the visible queued state.
            }
          }
          if (!completed) {
            setMaterialMessage('暂未收到分析终态；请以详情中的后台进度凭证、当前步骤和预计完成时间为准。');
          }
        })();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '全片精确分析提交失败';
      const markFailed = (item: TrendVideo): TrendVideo => ({
        ...item,
        status: item.aiAnalysis?.gemini ? 'analyzed' : 'failed',
        aiAnalysis: { ...(item.aiAnalysis || {}), requestedAnalysisMode: undefined, analysisError: message },
      });
      setCrawledVideos(items => items.map(item => item.id === video.id ? markFailed(item) : item));
      setSelectedVideo(item => item?.id === video.id ? markFailed(item) : item);
      setMaterialMessage(message);
    } finally {
      setAnalyzingVideoIds(ids => ids.filter(id => id !== video.id));
      setTimeout(() => setMaterialMessage(''), 3500);
    }
  };

  const cancelExactFullAnalysis = async (video: TrendVideo) => {
    if (!video.recordId) return;
    setMaterialMessage('正在停止本次精确分析…');
    try {
      await pauseExactAnalysis(video.recordId);
      const markPaused = (item: TrendVideo): TrendVideo => item.id !== video.id ? item : {
        ...item,
        status: item.aiAnalysis?.gemini || item.aiAnalysis?.analysisQuality ? 'analyzed' : 'failed',
        aiAnalysis: { ...(item.aiAnalysis || {}), analysisProgress: undefined, requestedAnalysisMode: undefined, geminiStatus: 'paused' },
      };
      setCrawledVideos(items => items.map(markPaused));
      setSelectedVideo(item => item ? markPaused(item) : item);
      setMaterialMessage('已停止。本次未产生的结果不会进入后续制作，可以重新分析。');
      window.setTimeout(() => setMaterialMessage(''), 3500);
    } catch (error) {
      setMaterialMessage(error instanceof Error ? error.message : '停止分析失败');
    }
  };

  return {
    analyzingVideoIds,
    retryVideoPipeline,
    reanalyzeImagePost,
    requestExactFullAnalysis,
    cancelExactFullAnalysis
  };
}
