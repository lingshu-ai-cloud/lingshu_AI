export interface PresenterLook {
  id: string; name: string; groupId?: string; voiceId?: string;
  imageUrl?: string; videoUrl?: string;
  orientation: 'unknown' | 'portrait' | 'landscape' | 'square';
  status: string;
}
export interface PresenterVoice { id: string; name: string; language: string; previewUrl?: string }
export interface PresenterPage<T> { items: T[]; nextToken: string }
export interface PresenterCreation {
  id: string; name: string; type: 'photo' | 'digital_twin'; voiceId?: string;
  status: 'submitting' | 'processing' | 'pending_consent' | 'completed' | 'failed' | 'uncertain';
  look?: PresenterLook; groupId?: string; error?: string; consentUrl?: string;
  consentRequestedAt?: string;
  createdAt: string; updatedAt: string;
}
export interface PresenterCapabilities {
  localPhotoUpload?: boolean; configured: boolean; creationEnabled: boolean; directConsent: boolean; privateCatalog: boolean; reason: string;
  reservationCny: number | null; photoReservationCny?: number | null; digitalTwinReservationCny?: number | null;
}
