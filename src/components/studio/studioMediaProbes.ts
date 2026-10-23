import { type Clip } from './studioSourceMaterial';


export const probeMedia = (f: File) => new Promise<{ duration: number; width: number; height: number }>(res => {
  if (f.type.startsWith('image')) {
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(image.src); res({ duration: 0, width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => res({ duration: 0, width: 0, height: 0 });
    image.src = URL.createObjectURL(f);
    return;
  }
  if (!f.type.startsWith('video')) { res({ duration: 0, width: 0, height: 0 }); return; }
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.onloadedmetadata = () => {
    URL.revokeObjectURL(v.src);
    res({ duration: Math.round(v.duration) || 0, width: v.videoWidth || 0, height: v.videoHeight || 0 });
  };
  v.onerror = () => res({ duration: 0, width: 0, height: 0 });
  v.src = URL.createObjectURL(f);
});

export const probeAudioDuration = (f: File) => new Promise<number>(res => {
  if (!f.type.startsWith('audio')) { res(0); return; }
  const a = document.createElement('audio');
  a.preload = 'metadata';
  // Keep sub-second precision. Rounding 13.44s down to 13s makes the renderer
  // stop before the final spoken word has finished.
  a.onloadedmetadata = () => {
    const measured = Number.isFinite(a.duration) ? Number(a.duration.toFixed(3)) : 0;
    URL.revokeObjectURL(a.src);
    res(measured);
  };
  a.onerror = () => res(0);
  a.src = URL.createObjectURL(f);
});

export const probeClipAspect = (clip: Clip) => new Promise<{ width: number; height: number }>(res => {
  const src = clip.type === 'image' ? clip.url : (clip.poster || clip.url);
  if (!src || clip.type === 'audio') { res({ width: 0, height: 0 }); return; }
  if (clip.type === 'image' || clip.poster) {
    const image = new Image();
    image.onload = () => res({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => res({ width: 0, height: 0 });
    image.src = src;
    return;
  }
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.onloadedmetadata = () => res({ width: video.videoWidth, height: video.videoHeight });
  video.onerror = () => res({ width: 0, height: 0 });
  video.src = src;
});
