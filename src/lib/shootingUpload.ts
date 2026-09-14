/** Probe the actual local file before sending metadata used by refill checks. */
export function probeShootingVideo(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const finish = (error?: string) => {
      window.clearTimeout(timer);
      const metadata = { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
      video.onloadedmetadata = null; video.onerror = null;
      video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
      if (error) reject(new Error(error)); else resolve(metadata);
    };
    const timer = window.setTimeout(() => finish('视频信息读取超时，请检查文件后重试'), 15000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0 && video.videoWidth > 0 && video.videoHeight > 0 ? undefined : '视频缺少有效时长或尺寸');
    video.onerror = () => finish('无法读取视频，请上传浏览器可播放的视频文件');
    video.src = url;
  });
}
