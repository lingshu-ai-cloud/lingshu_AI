


export const STUDIO_ACCENT = 'var(--color-accent)';

export const CANVA_VIDEO_COVER_URL = 'https://www.canva.cn/create/video-covers/';

export const CANVA_COVER_RETURN_KEY = 'ow_canva_cover_return';

export const CANVA_COVER_RETURN_TTL = 6 * 60 * 60 * 1000;

export const PUBLISH_RETURN_PREVIEW_KEY = 'ow_publish_return_to_preview';

export const STUDIO_OPEN_PROJECT_KEY = 'ow_studio_open_project';

export const PUBLISH_RETURN_PREVIEW_TTL = 2 * 60 * 60 * 1000;

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
