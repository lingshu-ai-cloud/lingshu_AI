import { parseSystemAnnouncement, systemAnnouncementIsActive, type SystemAnnouncement } from '../../shared/systemAnnouncement.js';

type AnnouncementEnvironmentKey =
  | 'SYSTEM_ANNOUNCEMENT_ENABLED'
  | 'SYSTEM_ANNOUNCEMENT_ID'
  | 'SYSTEM_ANNOUNCEMENT_TITLE'
  | 'SYSTEM_ANNOUNCEMENT_MESSAGE'
  | 'SYSTEM_ANNOUNCEMENT_PUBLISH_AT'
  | 'SYSTEM_ANNOUNCEMENT_MAINTENANCE_START_AT'
  | 'SYSTEM_ANNOUNCEMENT_MAINTENANCE_END_AT'
;

type AnnouncementEnvironment = Partial<Record<AnnouncementEnvironmentKey, string>>;

export function resolveSystemAnnouncement(
  environment: AnnouncementEnvironment = process.env,
  now = Date.now(),
): SystemAnnouncement | null {
  if (environment.SYSTEM_ANNOUNCEMENT_ENABLED !== 'true') return null;
  const startsAt = environment.SYSTEM_ANNOUNCEMENT_MAINTENANCE_START_AT?.trim() || '';
  const announcement = parseSystemAnnouncement({
    id: environment.SYSTEM_ANNOUNCEMENT_ID?.trim() || `maintenance:${startsAt}`,
    title: environment.SYSTEM_ANNOUNCEMENT_TITLE,
    message: environment.SYSTEM_ANNOUNCEMENT_MESSAGE,
    publishedAt: environment.SYSTEM_ANNOUNCEMENT_PUBLISH_AT?.trim() || null,
    maintenanceStartsAt: startsAt,
    maintenanceEndsAt: environment.SYSTEM_ANNOUNCEMENT_MAINTENANCE_END_AT,
  });
  return announcement && systemAnnouncementIsActive(announcement, now) ? announcement : null;
}
