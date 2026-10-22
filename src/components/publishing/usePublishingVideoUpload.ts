import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { getScrollBehavior } from '../../lib/usePrefersReducedMotion';
import { authHeader } from '../../lib/auth';
import { createPublishItem, titleFromVideoPath, type PublishQueueItem } from '../../lib/publishQueueState';

type UploadState = {
  activeItem: PublishQueueItem | null;
  pendingTargetAccountIds: string[];
  setItems: Dispatch<SetStateAction<PublishQueueItem[]>>;
  setActiveItemId: Dispatch<SetStateAction<string>>;
  setWorkspaceTab: Dispatch<SetStateAction<'schedule' | 'publish'>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
};

export function usePublishingVideoUpload({
  activeItem, pendingTargetAccountIds, setItems, setActiveItemId, setWorkspaceTab, setNotice, setError,
}: UploadState) {
  const [uploadingVideos, setUploadingVideos] = useState(false);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const addSelectedVideoFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []).filter(file => /\.(mp4|mov|webm|mkv|avi)$/i.test(file.name));
    if (!files.length) return;
    setUploadingVideos(true);
    setError('');
    setNotice('');
    const targetAccountIds = activeItem ? activeItem.targetAccountIds : pendingTargetAccountIds;
    const additions: PublishQueueItem[] = [];
    const failures: string[] = [];
    for (const file of files) {
      try {
        const response = await fetch('/api/overseas/publishing/local-videos', {
          method: 'POST',
          headers: {
            ...authHeader(),
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name),
          },
          body: file,
        });
        const data = await response.json().catch(() => ({})) as { video?: { videoPath?: string; previewUrl?: string }; error?: string };
        if (!response.ok || !data.video?.videoPath) throw new Error(data.error || '视频接收失败');
        additions.push(createPublishItem({
          videoPath: data.video.videoPath,
          previewUrl: data.video.previewUrl,
          title: titleFromVideoPath(file.name),
          description: activeItem?.description || '',
          ratio: activeItem?.ratio,
          platform: activeItem?.sourcePlatform,
          workflowRunId: activeItem?.workflowRunId,
          workflowTaskId: activeItem?.workflowTaskId,
          workflowTaskKey: activeItem?.workflowTaskKey,
        }, targetAccountIds));
      } catch (uploadError) {
        failures.push(`${file.name}: ${uploadError instanceof Error ? uploadError.message : '添加失败'}`);
      }
    }
    if (additions.length) {
      setItems(prev => {
        const onlyBlank = prev.length === 1 && !prev[0].videoPath.trim() && !prev[0].title.trim();
        return onlyBlank ? additions : [...prev, ...additions];
      });
      setActiveItemId(additions[0].id);
      setWorkspaceTab('publish');
      setNotice(`已加入 ${additions.length} 条视频，发布预览已启动。`);
      window.setTimeout(() => document.getElementById('publishing-video-preview')?.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' }), 80);
    }
    if (failures.length) setError(failures.join('；'));
    setUploadingVideos(false);
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  return { uploadingVideos, videoInputRef, addSelectedVideoFiles };
}
