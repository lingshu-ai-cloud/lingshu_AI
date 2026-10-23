import path from 'path';
import { fileURLToPath } from 'url';
import ffmpegStatic from 'ffmpeg-static';

export const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const GENERATED_MEDIA_DIR = path.join(__dirname, '../../data/media/generated');

export const SEEDANCE_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

export const MEDIA_DIR = path.join(__dirname, '../../data/media');

export const VIDEO_VERSIONS_FILE = path.join(__dirname, '../../data/studio-video-versions.json');

export const ffmpegBin = ffmpegStatic as unknown as string | null;

export const DIGITAL_HUMAN_JOBS_FILE = process.env.NODE_ENV === 'test' && process.env.DIGITAL_HUMAN_JOBS_FILE ? path.resolve(process.env.DIGITAL_HUMAN_JOBS_FILE) : path.join(__dirname, '../../data/digital-human-jobs.json');

export const DIGITAL_HUMAN_MAX_OUTPUT_BYTES = 110 * 1024 * 1024;

export const MAX_MATERIAL_UPLOAD_BYTES = 100 * 1024 * 1024;

export const COVERS_ROOT = path.join(__dirname, '../../data/covers');

export const TTS_ROOT = path.join(__dirname, '../../data/tts');

export const VOICE_SAMPLES_ROOT = path.join(__dirname, '../../data/voice-samples');
