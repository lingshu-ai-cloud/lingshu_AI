export const SOCIAL_CONTENT_MAX_FILE_BYTES = 110 * 1024 * 1024;
export const SOCIAL_CONTENT_MAX_TASK_FILE_BYTES = 512 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, readonly string[]> = {
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
  gif: ['image/gif'],
  mp4: ['video/mp4'],
  mov: ['video/quicktime'],
  webm: ['video/webm'],
  mp3: ['audio/mpeg'],
  wav: ['audio/wav', 'audio/x-wav'],
  m4a: ['audio/mp4', 'audio/x-m4a'],
  pdf: ['application/pdf'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  csv: ['text/csv', 'application/csv', 'application/vnd.ms-excel'],
  txt: ['text/plain'],
};

export const SOCIAL_CONTENT_FILE_ACCEPT = Object.keys(MIME_BY_EXTENSION).map(extension => `.${extension}`).join(',');

export function socialContentMimeForFileName(name: string, fallback = ''): string {
  const extension = name.toLowerCase().split('.').at(-1) || '';
  return MIME_BY_EXTENSION[extension]?.[0] || fallback || 'application/octet-stream';
}

interface CandidateFile {
  name: string;
  size: number;
  type: string;
}

export function validateSocialContentFile(file: CandidateFile): string | null {
  const extension = file.name.toLowerCase().split('.').at(-1) || '';
  const acceptedMimes = MIME_BY_EXTENSION[extension];
  if (!acceptedMimes) return `${file.name} 的格式暂不支持`;
  if (file.size > SOCIAL_CONTENT_MAX_FILE_BYTES) return `${file.name} 超过 110 MB`;
  if (file.type && file.type !== 'application/octet-stream' && !acceptedMimes.includes(file.type)) {
    return `${file.name} 的文件类型与后缀不匹配`;
  }
  return null;
}
