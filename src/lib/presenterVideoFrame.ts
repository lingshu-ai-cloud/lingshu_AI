export async function extractPresenterPhoto(videoFile: File): Promise<File> {
  const url = URL.createObjectURL(videoFile);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('无法读取视频，请上传本人照片或更换视频'));
      video.src = url;
    });
    const seconds = Math.min(1, Math.max(0, video.duration - 0.1));
    if (seconds > 0) await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error('视频抽帧失败，请上传本人照片'));
      video.currentTime = seconds;
    });
    if (!video.videoWidth || !video.videoHeight) throw new Error('视频没有可用画面，请上传本人照片');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法抽取视频画面，请上传本人照片');
    context.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('视频抽帧失败，请上传本人照片');
    return new File([blob], `${videoFile.name.replace(/\.[^.]+$/, '')}-frame.jpg`, {
      type: 'image/jpeg',
      lastModified: videoFile.lastModified,
    });
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
