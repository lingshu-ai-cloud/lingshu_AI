import type { ImageReplicationDraft } from './imageReplicationDraft';

const supported: { ratio: ImageReplicationDraft['aspectRatio']; value: number }[] = [
  { ratio: '1:1', value: 1 }, { ratio: '4:5', value: 4 / 5 },
  { ratio: '9:16', value: 9 / 16 }, { ratio: '16:9', value: 16 / 9 },
];

/** Choose the closest supported delivery canvas without rejecting ordinary source photos. */
export function imageReplicationReferenceRatio(width: number, height: number): ImageReplicationDraft['aspectRatio'] | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const actual = width / height;
  const nearest = [...supported].sort((a, b) => Math.abs(actual - a.value) - Math.abs(actual - b.value))[0];
  return nearest.ratio;
}
