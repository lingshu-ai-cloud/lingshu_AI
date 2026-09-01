import type { ReactNode } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  LoaderCircle,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Subtitles,
  Volume2,
} from 'lucide-react';

export type StudioLanguageGenerationStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'stale'
  | 'failed';

export type StudioLanguageRetryTarget = 'copy' | 'voice';

export interface StudioVoiceOption {
  id: string;
  label: string;
  description?: string;
}

export interface StudioVoiceSettings {
  voiceId?: string;
  voiceName?: string;
  availableVoices?: StudioVoiceOption[];
  style?: string;
  availableStyles?: string[];
  speed?: number;
  volume?: number;
  emotion?: string;
  availableEmotions?: string[];
}

export interface StudioSubtitleSummary {
  content?: string;
  cueCount?: number;
  styleSummary?: string;
  burnedIn?: boolean;
}

export interface StudioLanguageStatusItem {
  id: string;
  language: string;
  locale?: string;
  isSourceLanguage?: boolean;
  copyStatus: StudioLanguageGenerationStatus;
  copyProgress?: number;
  copyError?: string;
  voiceStatus: StudioLanguageGenerationStatus;
  voiceProgress?: number;
  voiceError?: string;
  durationSeconds?: number;
  canPreview?: boolean;
  voice?: StudioVoiceSettings;
  subtitle?: StudioSubtitleSummary;
}

export interface StudioLanguageStatusPanelProps {
  languages: StudioLanguageStatusItem[];
  selectedLanguageId?: string | null;
  previewingLanguageId?: string | null;
  className?: string;
  emptyState?: ReactNode;
  onSelectLanguage?: (languageId: string) => void;
  onEditCopy?: (languageId: string) => void;
  onGenerateVoice?: (languageId: string) => void;
  onRetry?: (languageId: string, target: StudioLanguageRetryTarget) => void;
  onPreviewVoice?: (languageId: string) => void;
  onRegenerateVoice?: (languageId: string) => void;
  onVoiceSettingsChange?: (
    languageId: string,
    patch: Partial<StudioVoiceSettings>,
  ) => void;
  onEditSubtitles?: (languageId: string) => void;
}

const STATUS_META: Record<
  StudioLanguageGenerationStatus,
  { label: string; className: string; icon: typeof Clock3 }
> = {
  pending: {
    label: '待生成',
    className: 'border-slate-200 bg-slate-50 text-slate-600',
    icon: Clock3,
  },
  processing: {
    label: '生成中',
    className: 'border-blue-200 bg-blue-50 text-blue-700',
    icon: LoaderCircle,
  },
  completed: {
    label: '已完成',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: CheckCircle2,
  },
  stale: {
    label: '需更新',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
    icon: RefreshCw,
  },
  failed: {
    label: '失败',
    className: 'border-red-200 bg-red-50 text-red-700',
    icon: AlertCircle,
  },
};

const clampProgress = (progress?: number) =>
  Math.min(100, Math.max(0, Math.round(progress ?? 0)));

const formatDuration = (seconds?: number) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  return `${seconds.toFixed(1)}s`;
};

function StatusBadge({
  status,
  progress,
}: {
  status: StudioLanguageGenerationStatus;
  progress?: number;
}) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  const normalizedProgress = clampProgress(progress);

  return (
    <span
      className={`inline-flex min-w-20 items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${meta.className}`}
    >
      <Icon
        aria-hidden="true"
        size={12}
        className={status === 'processing' ? 'animate-spin' : undefined}
      />
      {meta.label}
      {status === 'processing' && progress != null ? ` ${normalizedProgress}%` : null}
    </span>
  );
}

function StatusCell({
  label,
  status,
  progress,
  error,
}: {
  label: string;
  status: StudioLanguageGenerationStatus;
  progress?: number;
  error?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="md:hidden mb-1 text-[10px] font-bold uppercase tracking-wide text-text-muted">
        {label}
      </div>
      <StatusBadge status={status} progress={progress} />
      {status === 'failed' && error ? (
        <p className="mt-1.5 max-w-48 text-[11px] leading-4 text-red-600" title={error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ActionButton({
  children,
  icon,
  onClick,
  disabled,
  title,
}: {
  children: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  if (!onClick) return null;

  return (
    <button
      type="button"
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-2.5 text-[11px] font-bold text-text-secondary transition hover:border-accent/40 hover:bg-surface-2 hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
    >
      {icon}
      {children}
    </button>
  );
}

function LanguageActions({
  item,
  previewing,
  onEditCopy,
  onGenerateVoice,
  onRetry,
  onPreviewVoice,
}: {
  item: StudioLanguageStatusItem;
  previewing: boolean;
  onEditCopy?: (languageId: string) => void;
  onGenerateVoice?: (languageId: string) => void;
  onRetry?: (languageId: string, target: StudioLanguageRetryTarget) => void;
  onPreviewVoice?: (languageId: string) => void;
}) {
  const copyProcessing = item.copyStatus === 'processing';
  const voiceProcessing = item.voiceStatus === 'processing';
  const voiceReady = item.voiceStatus === 'completed';

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {item.copyStatus === 'failed' ? (
        <ActionButton
          icon={<RotateCcw aria-hidden="true" size={12} />}
          onClick={onRetry ? () => onRetry(item.id, 'copy') : undefined}
        >
          重试文案
        </ActionButton>
      ) : (
        <ActionButton
          icon={<Pencil aria-hidden="true" size={12} />}
          onClick={onEditCopy ? () => onEditCopy(item.id) : undefined}
          disabled={copyProcessing}
        >
          编辑
        </ActionButton>
      )}

      {item.voiceStatus === 'failed' ? (
        <ActionButton
          icon={<RotateCcw aria-hidden="true" size={12} />}
          onClick={onRetry ? () => onRetry(item.id, 'voice') : undefined}
        >
          重试配音
        </ActionButton>
      ) : voiceReady && item.canPreview !== false ? (
        <ActionButton
          icon={
            previewing ? (
              <LoaderCircle aria-hidden="true" size={12} className="animate-spin" />
            ) : (
              <Play aria-hidden="true" size={12} />
            )
          }
          onClick={onPreviewVoice ? () => onPreviewVoice(item.id) : undefined}
          disabled={previewing}
        >
          {previewing ? '加载试听' : '试听'}
        </ActionButton>
      ) : (
        <ActionButton
          icon={
            voiceProcessing ? (
              <LoaderCircle aria-hidden="true" size={12} className="animate-spin" />
            ) : (
              <Volume2 aria-hidden="true" size={12} />
            )
          }
          onClick={onGenerateVoice ? () => onGenerateVoice(item.id) : undefined}
          disabled={voiceProcessing || copyProcessing || item.copyStatus === 'failed'}
          title={item.copyStatus === 'failed' ? '请先重试文案' : undefined}
        >
          {voiceProcessing ? '生成配音中' : '生成配音'}
        </ActionButton>
      )}
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1.5 block text-[11px] font-bold text-text-secondary">
      {children}
    </span>
  );
}

function SelectedLanguageDetails({
  item,
  previewing,
  onPreviewVoice,
  onRegenerateVoice,
  onVoiceSettingsChange,
  onEditSubtitles,
}: {
  item: StudioLanguageStatusItem;
  previewing: boolean;
  onPreviewVoice?: (languageId: string) => void;
  onRegenerateVoice?: (languageId: string) => void;
  onVoiceSettingsChange?: (
    languageId: string,
    patch: Partial<StudioVoiceSettings>,
  ) => void;
  onEditSubtitles?: (languageId: string) => void;
}) {
  const voice = item.voice ?? {};
  const subtitle = item.subtitle;
  const controlsDisabled = item.voiceStatus === 'processing';
  const settingsDisabled = controlsDisabled || !onVoiceSettingsChange;
  const setVoice = (patch: Partial<StudioVoiceSettings>) =>
    onVoiceSettingsChange?.(item.id, patch);

  return (
    <section
      aria-label={`${item.language}配音与字幕设置`}
      className="border-t border-border bg-surface px-3 py-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-black text-text-primary">
            <SlidersHorizontal aria-hidden="true" size={15} className="text-accent" />
            {item.language} · 配音与字幕
          </h4>
          <p className="mt-1 text-[11px] text-text-muted">
            只调整当前语言，不影响其他已完成结果。
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ActionButton
            icon={
              previewing ? (
                <LoaderCircle aria-hidden="true" size={12} className="animate-spin" />
              ) : (
                <Play aria-hidden="true" size={12} />
              )
            }
            onClick={onPreviewVoice ? () => onPreviewVoice(item.id) : undefined}
            disabled={previewing || item.voiceStatus !== 'completed'}
          >
            {previewing ? '加载试听' : '试听配音'}
          </ActionButton>
          <ActionButton
            icon={<RefreshCw aria-hidden="true" size={12} />}
            onClick={onRegenerateVoice ? () => onRegenerateVoice(item.id) : undefined}
            disabled={controlsDisabled || item.copyStatus === 'failed'}
          >
            重新生成
          </ActionButton>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Volume2 aria-hidden="true" size={14} className="text-accent" />
            <h5 className="text-xs font-black text-text-primary">配音属性</h5>
            <span className="ml-auto text-[11px] font-semibold text-text-muted">
              真实时长 {formatDuration(item.durationSeconds)}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label>
              <FieldLabel>音色</FieldLabel>
              {voice.availableVoices?.length ? (
                <select
                  value={voice.voiceId ?? ''}
                  onChange={(event) => setVoice({ voiceId: event.target.value })}
                  disabled={settingsDisabled}
                  className="h-9 w-full rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-semibold text-text-primary outline-none focus:border-accent disabled:opacity-50"
                >
                  <option value="">选择音色</option>
                  {voice.availableVoices.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex h-9 items-center rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-semibold text-text-secondary">
                  {voice.voiceName || '默认音色'}
                </div>
              )}
            </label>

            <label>
              <FieldLabel>风格</FieldLabel>
              <select
                value={voice.style ?? ''}
                onChange={(event) => setVoice({ style: event.target.value })}
                disabled={settingsDisabled || !voice.availableStyles?.length}
                className="h-9 w-full rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-semibold text-text-primary outline-none focus:border-accent disabled:opacity-50"
              >
                <option value="">{voice.style || '默认风格'}</option>
                {voice.availableStyles?.filter((style) => style !== voice.style).map((style) => (
                  <option key={style} value={style}>
                    {style}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <FieldLabel>情绪</FieldLabel>
              <select
                value={voice.emotion ?? ''}
                onChange={(event) => setVoice({ emotion: event.target.value })}
                disabled={settingsDisabled || !voice.availableEmotions?.length}
                className="h-9 w-full rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-semibold text-text-primary outline-none focus:border-accent disabled:opacity-50"
              >
                <option value="">{voice.emotion || '自然'}</option>
                {voice.availableEmotions
                  ?.filter((emotion) => emotion !== voice.emotion)
                  .map((emotion) => (
                    <option key={emotion} value={emotion}>
                      {emotion}
                    </option>
                  ))}
              </select>
            </label>

            <label className="sm:col-span-1">
              <FieldLabel>语速 · {(voice.speed ?? 1).toFixed(1)}x</FieldLabel>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={voice.speed ?? 1}
                onChange={(event) => setVoice({ speed: Number(event.target.value) })}
                disabled={settingsDisabled}
                className="h-9 w-full accent-[var(--color-accent)] disabled:opacity-50"
              />
            </label>

            <label className="sm:col-span-1 xl:col-span-2">
              <FieldLabel>音量 · {Math.round((voice.volume ?? 1) * 100)}%</FieldLabel>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.05"
                value={voice.volume ?? 1}
                onChange={(event) => setVoice({ volume: Number(event.target.value) })}
                disabled={settingsDisabled}
                className="h-9 w-full accent-[var(--color-accent)] disabled:opacity-50"
              />
            </label>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <Subtitles aria-hidden="true" size={14} className="text-accent" />
            <h5 className="text-xs font-black text-text-primary">字幕概要</h5>
            <ActionButton
              icon={<Pencil aria-hidden="true" size={12} />}
              onClick={onEditSubtitles ? () => onEditSubtitles(item.id) : undefined}
            >
              编辑字幕
            </ActionButton>
          </div>

          {subtitle ? (
            <div className="mt-3 space-y-2 text-[11px] leading-5 text-text-secondary">
              <p className="line-clamp-3 rounded-lg bg-surface-2 px-2.5 py-2">
                {subtitle.content || '字幕内容已生成，可进入编辑查看。'}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>{subtitle.cueCount ?? 0} 条字幕</span>
                <span>{subtitle.styleSummary || '使用默认字幕模板'}</span>
                <span>{subtitle.burnedIn ? '已烧录字幕' : '独立字幕轨'}</span>
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-border bg-surface-2 px-3 py-4 text-center text-[11px] text-text-muted">
              当前语言尚无字幕概要，生成配音后可继续编辑。
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function StudioLanguageStatusPanel({
  languages,
  selectedLanguageId,
  previewingLanguageId,
  className = '',
  emptyState,
  onSelectLanguage,
  onEditCopy,
  onGenerateVoice,
  onRetry,
  onPreviewVoice,
  onRegenerateVoice,
  onVoiceSettingsChange,
  onEditSubtitles,
}: StudioLanguageStatusPanelProps) {
  const selectedLanguage = languages.find((item) => item.id === selectedLanguageId);

  if (!languages.length) {
    return (
      <section className={`rounded-2xl border border-border bg-surface p-5 ${className}`}>
        {emptyState ?? (
          <div className="flex min-h-36 flex-col items-center justify-center text-center">
            <Volume2 aria-hidden="true" size={22} className="mb-2 text-text-muted" />
            <h3 className="text-sm font-black text-text-primary">尚未添加输出语言</h3>
            <p className="mt-1 max-w-sm text-xs leading-5 text-text-muted">
              返回创作设置选择输出语言后，可在这里统一管理文案、配音与字幕。
            </p>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className={`overflow-hidden rounded-2xl border border-border bg-surface ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3.5">
        <div>
          <h3 className="text-sm font-black text-text-primary">多语言状态</h3>
          <p className="mt-1 text-[11px] leading-4 text-text-muted">
            每种语言独立生成与重试，已完成内容会立即保留。
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold text-text-muted">
          <CheckCircle2 aria-hidden="true" size={13} className="text-emerald-600" />
          已完成 {languages.filter((item) => item.voiceStatus === 'completed').length}/
          {languages.length}
        </div>
      </header>

      <div className="hidden">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead className="bg-surface-2 text-[10px] font-bold uppercase tracking-wide text-text-muted">
            <tr>
              <th className="w-[20%] px-4 py-2.5">语言</th>
              <th className="w-[19%] px-3 py-2.5">文案状态</th>
              <th className="w-[19%] px-3 py-2.5">配音状态</th>
              <th className="w-[12%] px-3 py-2.5 text-right">真实时长</th>
              <th className="w-[30%] px-4 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {languages.map((item) => {
              const selected = item.id === selectedLanguageId;
              return (
                <tr
                  key={item.id}
                  tabIndex={onSelectLanguage ? 0 : undefined}
                  aria-selected={selected}
                  onClick={() => onSelectLanguage?.(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectLanguage?.(item.id);
                    }
                  }}
                  className={`transition ${
                    onSelectLanguage ? 'cursor-pointer' : ''
                  } ${selected ? 'bg-accent/5' : 'hover:bg-surface-2/60'}`}
                >
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-start gap-2">
                      <ChevronDown
                        aria-hidden="true"
                        size={14}
                        className={`mt-0.5 shrink-0 text-text-muted transition ${
                          selected ? 'rotate-180 text-accent' : '-rotate-90'
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-black text-text-primary">
                          {item.language}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-text-muted">
                          {item.locale ? <span>{item.locale}</span> : null}
                          {item.isSourceLanguage ? (
                            <span className="rounded bg-surface-2 px-1.5 py-0.5 font-bold">
                              原始语言
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <StatusCell
                      label="文案状态"
                      status={item.copyStatus}
                      progress={item.copyProgress}
                      error={item.copyError}
                    />
                  </td>
                  <td className="px-3 py-3 align-top">
                    <StatusCell
                      label="配音状态"
                      status={item.voiceStatus}
                      progress={item.voiceProgress}
                      error={item.voiceError}
                    />
                  </td>
                  <td className="px-3 py-3 text-right align-top text-xs font-bold tabular-nums text-text-secondary">
                    {formatDuration(item.durationSeconds)}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <LanguageActions
                      item={item}
                      previewing={previewingLanguageId === item.id}
                      onEditCopy={onEditCopy}
                      onGenerateVoice={onGenerateVoice}
                      onRetry={onRetry}
                      onPreviewVoice={onPreviewVoice}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-border">
        {languages.map((item) => {
          const selected = item.id === selectedLanguageId;
          return (
            <article
              key={item.id}
              aria-selected={selected}
              className={selected ? 'bg-accent/5' : 'bg-white'}
            >
              <button
                type="button"
                onClick={() => onSelectLanguage?.(item.id)}
                className="flex w-full items-center gap-2 px-3 py-3 text-left"
              >
                <ChevronDown
                  aria-hidden="true"
                  size={14}
                  className={`shrink-0 text-text-muted transition ${
                    selected ? 'rotate-180 text-accent' : '-rotate-90'
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-black text-text-primary">
                    {item.language}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-text-muted">
                    {item.isSourceLanguage ? '原始语言 · ' : ''}
                    {item.locale || '输出语言'}
                  </span>
                </span>
                <span className="text-xs font-bold tabular-nums text-text-secondary">
                  {formatDuration(item.durationSeconds)}
                </span>
              </button>

              <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                <StatusCell
                  label="文案状态"
                  status={item.copyStatus}
                  progress={item.copyProgress}
                  error={item.copyError}
                />
                <StatusCell
                  label="配音状态"
                  status={item.voiceStatus}
                  progress={item.voiceProgress}
                  error={item.voiceError}
                />
                <div className="col-span-2 pt-1">
                  <LanguageActions
                    item={item}
                    previewing={previewingLanguageId === item.id}
                    onEditCopy={onEditCopy}
                    onGenerateVoice={onGenerateVoice}
                    onRetry={onRetry}
                    onPreviewVoice={onPreviewVoice}
                  />
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {selectedLanguage ? (
        <SelectedLanguageDetails
          item={selectedLanguage}
          previewing={previewingLanguageId === selectedLanguage.id}
          onPreviewVoice={onPreviewVoice}
          onRegenerateVoice={onRegenerateVoice}
          onVoiceSettingsChange={onVoiceSettingsChange}
          onEditSubtitles={onEditSubtitles}
        />
      ) : null}
    </section>
  );
}
