import {
  Avatar,
  Button,
  Empty,
  Image,
  Masonry,
  Modal,
  Progress,
  Skeleton,
  Space,
  Spin,
  Steps,
  type AvatarProps,
  type ButtonProps,
  type ImageProps,
  type ModalProps,
  type ProgressProps,
  type StepsProps,
} from 'antd';
import type { ReactNode } from 'react';

export const LINGSHU_PROGRESS_GRADIENT = {
  '0%': '#117F51',
  '56%': '#2F9DA5',
  '100%': '#86C968',
} as const;

export function LsBrandAction({ className = '', ...props }: ButtonProps) {
  return <Button type="primary" {...props} className={`ls-brand-action ${className}`.trim()} />;
}

export function LsGradientProgress({
  percent,
  className = '',
  strokeColor,
  ...props
}: ProgressProps) {
  const safePercent = typeof percent === 'number' ? Math.min(100, Math.max(0, percent)) : percent;
  return (
    <Progress
      {...props}
      aria-label={props['aria-label'] || (typeof safePercent === 'number' ? `完成 ${Math.round(safePercent)}%` : '任务进度')}
      className={`ls-gradient-progress ${className}`.trim()}
      percent={safePercent}
      strokeColor={strokeColor || LINGSHU_PROGRESS_GRADIENT}
      railColor={props.railColor || '#E8EFEA'}
    />
  );
}

export function LsLoadingState({
  loading,
  mode = 'skeleton',
  label = '正在加载',
  description,
  className = '',
  children,
}: {
  loading: boolean;
  mode?: 'skeleton' | 'spin';
  label?: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  if (!loading) return <>{children}</>;
  if (mode === 'spin') {
    return <div className={`ls-loading-state ${className}`.trim()} role="status" aria-live="polite"><Spin description={label} />{description ? <p>{description}</p> : null}</div>;
  }
  return <div className={`ls-loading-state ${className}`.trim()} role="status" aria-label={label}><Skeleton active paragraph={{ rows: 4 }} />{description ? <p>{description}</p> : null}</div>;
}

export function LsProgressiveMedia({
  className = '',
  rootClassName = '',
  fallback = '/image-placeholder.svg',
  ...props
}: ImageProps) {
  return (
    <Image
      {...props}
      className={`ls-progressive-media ${className}`.trim()}
      rootClassName={`ls-progressive-media-root ${rootClassName}`.trim()}
      fallback={fallback}
      placeholder={{ progress: true }}
    />
  );
}

export type LsMediaState = 'loading' | 'processing' | 'ready' | 'error';

export function LsMediaStateFrame({
  state,
  percent,
  label,
  className = '',
  children,
}: {
  state: LsMediaState;
  percent?: number | null;
  label?: string;
  className?: string;
  children?: ReactNode;
}) {
  const safePercent = typeof percent === 'number' ? Math.min(100, Math.max(0, percent)) : null;
  const statusLabel = label || (state === 'loading' ? '正在加载' : state === 'processing' ? '正在处理' : state === 'error' ? '媒体加载失败' : '媒体已就绪');
  return <div className={`ls-media-state-frame is-${state} ${className}`.trim()} data-media-state={state}>
    {children}
    {state !== 'ready' && <div className="ls-media-state-frame__overlay" role="status" aria-live="polite">
      {state === 'loading' && <Spin size="small" />}
      {state === 'processing' && <LsGradientProgress percent={safePercent ?? 0} showInfo={false} size="small" />}
      <span>{safePercent !== null && state === 'processing' ? `${statusLabel} ${Math.round(safePercent)}%` : statusLabel}</span>
    </div>}
  </div>;
}

export function LsFlowDialog({
  current,
  steps,
  children,
  className = '',
  ...props
}: Omit<ModalProps, 'children'> & {
  current: number;
  steps: NonNullable<StepsProps['items']>;
  children: ReactNode;
}) {
  return (
    <Modal {...props} className={`ls-flow-dialog ${className}`.trim()}>
      <Steps className="ls-flow-dialog__steps" size="small" responsive current={current} items={steps} />
      <div className="ls-flow-dialog__content">{children}</div>
    </Modal>
  );
}

export type LsAvatarPerson = {
  id: string;
  name: string;
  src?: string;
  icon?: ReactNode;
  color?: string;
};

export function LsAvatarGroup({
  people,
  max = 4,
  size = 32,
  className = '',
}: {
  people: LsAvatarPerson[];
  max?: number;
  size?: AvatarProps['size'];
  className?: string;
}) {
  return (
    <Avatar.Group
      className={`ls-avatar-group ${className}`.trim()}
      max={{ count: max, popover: { trigger: 'hover', placement: 'bottom' } }}
      size={size}
    >
      {people.map(person => (
        <Avatar
          key={person.id}
          src={person.src}
          icon={person.icon}
          aria-label={person.name}
          style={{ backgroundColor: person.color || '#EAF6F2', color: '#173D31' }}
        >
          {!person.src && !person.icon ? person.name.trim().slice(0, 1).toUpperCase() : null}
        </Avatar>
      ))}
    </Avatar.Group>
  );
}

export function LsCompactFieldGroup({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <Space.Compact className={`ls-compact-field-group ${className}`.trim()}>{children}</Space.Compact>;
}

export type LsMasonryItem = {
  id: string;
  content: ReactNode;
};

export function LsMasonryGallery({
  items,
  emptyText = '暂无素材',
  className = '',
}: {
  items: LsMasonryItem[];
  emptyText?: string;
  className?: string;
}) {
  if (!items.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  return (
    <Masonry
      className={`ls-masonry-gallery ${className}`.trim()}
      columns={{ xs: 1, sm: 2, md: 3, lg: 4, xl: 5 }}
      gutter={[16, 16]}
      items={items.map(item => ({ key: item.id, data: item, children: item.content }))}
    />
  );
}
