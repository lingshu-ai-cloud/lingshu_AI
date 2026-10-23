import type { Dispatch, SetStateAction } from 'react';
import { authHeader } from '../../lib/auth';
import { recordsToVideos, type CrawlerRecord } from './inspirationVideoProjection';
import type { TrendVideo } from '../../lib/inspirationTypes';

interface ReferenceImportContext {
  setImportingReference: (value: boolean) => void;
  setMaterialMessage: (value: string) => void;
  setCrawledVideos: Dispatch<SetStateAction<TrendVideo[]>>;
  setSelectedVideo: Dispatch<SetStateAction<TrendVideo | null>>;
  referenceUploadInputRef: { current: HTMLInputElement | null };
  refreshInventory: () => Promise<unknown>;
  refreshVideos: (page: number, quiet: boolean) => Promise<unknown>;
  request?: typeof fetch;
  authorization?: typeof authHeader;
  delay?: (milliseconds: number) => Promise<void>;
}

export function createInspirationReferenceImporter(context: ReferenceImportContext) {
  const request = context.request || fetch;
  const authorization = context.authorization || authHeader;
  const delay = context.delay || ((milliseconds: number) => new Promise<void>(resolve => window.setTimeout(resolve, milliseconds)));

  return async function importReferenceVideo(file: File | undefined): Promise<void> {
    if (!file) return;
    if (file.type !== 'video/mp4' && !/\.mp4$/i.test(file.name)) {
      context.setMaterialMessage('对标视频请使用 MP4 文件');
      return;
    }
    if (file.size > 32 * 1024 * 1024) {
      context.setMaterialMessage('对标视频不能超过 32 MB');
      return;
    }
    context.setImportingReference(true);
    context.setMaterialMessage(`正在导入对标视频：${file.name}`);
    const requestAuthorization = authorization();
    const sameAuthorization = () => authorization().Authorization === requestAuthorization.Authorization;
    try {
      const params = new URLSearchParams({ title: file.name.replace(/\.mp4$/i, ''), platform: 'tiktok' });
      const response = await request(`/api/overseas/videos/import-reference-file?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'video/mp4', ...requestAuthorization },
        body: file,
      });
      const result = await response.json().catch(() => ({})) as { id?: string; error?: string; deduplicated?: boolean; analysisQueued?: boolean };
      if (!sameAuthorization()) return;
      if (!response.ok || !result.id) throw new Error(result.error || `导入失败（HTTP ${response.status}）`);
      const recordId = result.id;
      const readRecord = async (open = false) => {
        if (!sameAuthorization()) throw new Error('授权范围已更新');
        const latestResponse = await request(`/api/overseas/videos/${encodeURIComponent(recordId)}`, { headers: authorization() });
        if (!latestResponse.ok) throw new Error('对标视频记录读取失败');
        const record = await latestResponse.json() as CrawlerRecord;
        if (!sameAuthorization()) throw new Error('授权范围已更新');
        const video = recordsToVideos([record])[0];
        if (!video) throw new Error('对标视频记录格式异常');
        context.setCrawledVideos(items => [video, ...items.filter(item => item.id !== video.id)]);
        context.setSelectedVideo(current => open || current?.id === video.id ? video : current);
        return video;
      };
      await readRecord(true);
      context.setMaterialMessage(result.deduplicated
        ? result.analysisQueued
          ? '已找到相同对标视频，并已重新提交全片逐镜分析。'
          : '已找到相同对标视频，正在打开分析记录。'
        : '对标视频已入库，正在进行全片逐镜分析。');
      void context.refreshInventory();
      void (async () => {
        for (let attempt = 0; attempt < 120; attempt += 1) {
          await delay(3000);
          if (!sameAuthorization()) return;
          try {
            const latest = await readRecord();
            const status = latest.aiAnalysis?.geminiStatus;
            if (status === 'analyzed' || status === 'needs_review' || status === 'analysis_retryable' || status === 'video_failed' || latest.status === 'failed') {
              context.setMaterialMessage(status === 'analyzed' ? '逐镜分析完成，请检查编导交接结果。' : '逐镜分析需要复核，请查看记录中的具体原因。');
              void context.refreshVideos(1, true);
              return;
            }
          } catch {
            // A brief backend reload must not discard a queued import.
          }
        }
        if (!sameAuthorization()) return;
        context.setMaterialMessage('分析仍在后台运行，请稍后刷新灵感大屏查看结果。');
      })();
    } catch (error) {
      if (sameAuthorization()) context.setMaterialMessage(error instanceof Error ? error.message : '对标视频导入失败');
    } finally {
      context.setImportingReference(false);
      if (context.referenceUploadInputRef.current) context.referenceUploadInputRef.current.value = '';
    }
  };
}
