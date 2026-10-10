/** Public creative metadata. Storage references and provider credentials never cross this boundary. */
export type PlatformAdCreativeStatus = 'pending' | 'uploading' | 'processing' | 'ready' | 'failed' | 'unknown';
export interface PlatformAdCreative {
  id: string; taskId: string; taskVersion: number; sourceTaskId: string; artifactId: string;
  sha256: string; mimeType: string; size: number; name: string; connectionId: string;
  provider: 'meta' | 'tiktok'; platformVideoId: string; status: PlatformAdCreativeStatus;
  createdAt: string; updatedAt: string;
}
export interface PlatformAdCreativeSource {
  sourceTaskId: string; artifactId: string; name: string; mimeType: string; size: number; sha256: string;
}
