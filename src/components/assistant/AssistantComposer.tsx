import {
  forwardRef,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { App } from 'antd';
import { ArrowUp, FileAudio2, FileImage, FileVideo2, Loader2, Paperclip, Plus, Sparkles, X } from 'lucide-react';

export type AssistantAttachmentKind = 'image' | 'video' | 'audio';

export const ASSISTANT_ATTACHMENT_LIMIT = 3;
export const ASSISTANT_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

const EXTENSION_KIND: Record<string, AssistantAttachmentKind> = {
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image', heic: 'image', heif: 'image',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', weba: 'audio',
};

export function assistantAttachmentKind(file: Pick<File, 'name' | 'type'>): AssistantAttachmentKind | null {
  const mimeKind = String(file.type || '').split('/', 1)[0];
  if (mimeKind === 'image' || mimeKind === 'video' || mimeKind === 'audio') return mimeKind;
  const extension = String(file.name || '').split('.').at(-1)?.toLowerCase() || '';
  return EXTENSION_KIND[extension] || null;
}

export function formatAssistantAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function mergeAssistantAttachments(current: File[], incoming: File[]): { files: File[]; error?: string } {
  const accepted: File[] = [];
  const existing = new Set(current.map(file => `${file.name}:${file.size}:${file.lastModified}`));
  let error = '';
  for (const file of incoming) {
    if (!assistantAttachmentKind(file)) {
      error ||= `${file.name} 不是可上传的图片、视频或音频。`;
      continue;
    }
    if (!file.size) {
      error ||= `${file.name} 是空文件。`;
      continue;
    }
    if (file.size > ASSISTANT_ATTACHMENT_MAX_BYTES) {
      error ||= `${file.name} 超过 100 MB。`;
      continue;
    }
    const identity = `${file.name}:${file.size}:${file.lastModified}`;
    if (existing.has(identity)) continue;
    if (current.length + accepted.length >= ASSISTANT_ATTACHMENT_LIMIT) {
      error ||= `每次最多添加 ${ASSISTANT_ATTACHMENT_LIMIT} 个附件。`;
      break;
    }
    existing.add(identity);
    accepted.push(file);
  }
  return { files: [...current, ...accepted], ...(error ? { error } : {}) };
}

function AttachmentIcon({ kind }: { kind: AssistantAttachmentKind }) {
  if (kind === 'video') return <FileVideo2 aria-hidden="true" size={13} />;
  if (kind === 'audio') return <FileAudio2 aria-hidden="true" size={13} />;
  return <FileImage aria-hidden="true" size={13} />;
}

interface AssistantComposerProps {
  variant?: 'default' | 'home';
  draft: string;
  files: File[];
  disabled?: boolean;
  uploading?: boolean;
  error?: string;
  onDraftChange: (value: string) => void;
  onFilesChange: (files: File[]) => void;
  onValidationError: (message: string) => void;
  onSubmit: () => void;
}

const AssistantComposer = forwardRef<HTMLTextAreaElement, AssistantComposerProps>(function AssistantComposer({
  variant = 'default',
  draft,
  files,
  disabled = false,
  uploading = false,
  error = '',
  onDraftChange,
  onFilesChange,
  onValidationError,
  onSubmit,
}, forwardedRef) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { message } = App.useApp();

  const guideToViralVideo = () => {
    const library = document.getElementById('creator-home-library');
    if (!library) {
      void message.info({ key: 'choose-viral-video', content: '请先切换到自由创作，再从爆款视频中选择想要复刻的视频。', duration: 4 });
      return;
    }
    void message.info({ key: 'choose-viral-video', content: '请在下方爆款视频中选择想要复刻的视频，再点击「爆款裂变」。', duration: 4 });
    library.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const merged = mergeAssistantAttachments(files, Array.from(event.currentTarget.files || []));
    onFilesChange(merged.files);
    onValidationError(merged.error || '');
    event.currentTarget.value = '';
  };

  const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!disabled && !uploading && (draft.trim() || files.length)) onSubmit();
  };

  return (
    <div data-assistant-composer="true" data-variant={variant} className="ls-assistant-composer shrink-0">
      <div data-assistant-composer-surface="true" className="ls-assistant-composer__surface">
        {files.length > 0 && (
          <div data-assistant-attachments="pending" className="flex flex-wrap gap-1.5 border-b border-border/70 px-2.5 py-2">
            {files.map(file => {
              const identity = `${file.name}:${file.size}:${file.lastModified}`;
              const kind = assistantAttachmentKind(file) || 'image';
              return (
                <span key={identity} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-[10px] text-text-secondary">
                  <AttachmentIcon kind={kind} />
                  <span className="max-w-40 truncate font-semibold" title={file.name}>{file.name}</span>
                  <span className="shrink-0 text-text-muted">{formatAssistantAttachmentSize(file.size)}</span>
                  <button
                    type="button"
                    disabled={disabled || uploading}
                    onClick={() => onFilesChange(files.filter(candidate => candidate !== file))}
                    className="ml-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-3 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                    aria-label={`移除附件 ${file.name}`}
                  >
                    <X aria-hidden="true" size={11} />
                  </button>
                </span>
              );
            })}
            <span className="self-center text-[9px] text-text-muted">待随消息上传</span>
          </div>
        )}
        <div className="ls-assistant-composer__editing">
          {variant === 'home' && <button type="button" className="ls-assistant-composer__add-tile" onClick={guideToViralVideo} aria-label="选择爆款视频进行复刻" title="从爆款视频中选择复刻参考"><Plus size={26} aria-hidden="true" /></button>}
          <textarea
            ref={forwardedRef}
            value={draft}
            onChange={event => onDraftChange(event.target.value)}
            onKeyDown={submitOnEnter}
            rows={1}
            maxLength={4000}
            aria-label="给灵小枢发送消息"
            placeholder={variant === 'home' ? '输入想法、脚本或上传参考，和灵小枢一起创作' : '告诉灵小枢你想完成什么...'}
            className="ls-assistant-composer__input max-h-[88px] min-h-10 w-full resize-none overflow-y-auto bg-transparent px-3 pt-3 text-sm leading-6 text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="ls-assistant-composer__tools min-w-0">
            {variant === 'home' && <span className="ls-assistant-composer__mode"><Sparkles size={16} aria-hidden="true"/>Agent 模式</span>}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,audio/*"
              className="sr-only"
              onChange={selectFiles}
              disabled={disabled || uploading || files.length >= ASSISTANT_ATTACHMENT_LIMIT}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || uploading || files.length >= ASSISTANT_ATTACHMENT_LIMIT}
              className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-text-secondary hover:bg-surface hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
              aria-label="添加附件"
              title="添加图片、视频或音频；发送时才会上传到我的素材"
            >
              <Paperclip aria-hidden="true" size={14} />
              <span>{variant === 'home' ? '添加参考' : '附件'}</span>
            </button>
          </div>
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled || uploading || (!draft.trim() && !files.length)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-40"
            aria-label={uploading ? '正在上传附件' : '发送消息'}
          >
            {disabled || uploading ? <Loader2 aria-hidden="true" size={13} className="animate-spin" /> : <ArrowUp aria-hidden="true" size={13} />}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-1.5 text-[10px] leading-4 text-red">{error}</p>}
    </div>
  );
});

export default AssistantComposer;
