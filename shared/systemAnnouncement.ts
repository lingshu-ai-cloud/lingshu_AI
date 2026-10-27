export interface SystemAnnouncement {
  id: string;
  title: string;
  message: string;
  publishedAt: string | null;
  maintenanceStartsAt: string;
  maintenanceEndsAt: string;
}

const RFC3339_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !RFC3339_WITH_ZONE.test(value.trim())) return null;
  const normalized = value.trim();
  return Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

export function parseSystemAnnouncement(value: unknown): SystemAnnouncement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = boundedText(record.id, 160);
  const title = boundedText(record.title, 80);
  const message = boundedText(record.message, 500);
  const publishedAt = record.publishedAt === null ? null : timestamp(record.publishedAt);
  const maintenanceStartsAt = timestamp(record.maintenanceStartsAt);
  const maintenanceEndsAt = timestamp(record.maintenanceEndsAt);
  if (!id || !title || !message || record.publishedAt !== null && !publishedAt || !maintenanceStartsAt || !maintenanceEndsAt) return null;
  if (Date.parse(maintenanceEndsAt) <= Date.parse(maintenanceStartsAt)) return null;
  if (publishedAt && Date.parse(publishedAt) >= Date.parse(maintenanceEndsAt)) return null;
  return { id, title, message, publishedAt, maintenanceStartsAt, maintenanceEndsAt };
}

export function systemAnnouncementIsActive(announcement: SystemAnnouncement, now = Date.now()): boolean {
  const publishTime = announcement.publishedAt ? Date.parse(announcement.publishedAt) : Number.NEGATIVE_INFINITY;
  return now >= publishTime && now < Date.parse(announcement.maintenanceEndsAt);
}
