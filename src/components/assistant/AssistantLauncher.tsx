import type { RefObject } from 'react';
import { Badge, Button } from 'antd';
import { Bot, ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  retracted: boolean;
  chatOpen: boolean;
  badgeCount: number;
  launcherButtonRef: RefObject<HTMLAnchorElement | HTMLButtonElement | null>;
  edgeLauncherButtonRef: RefObject<HTMLAnchorElement | HTMLButtonElement | null>;
  onLauncherClick: () => void;
  onRetract: () => void;
  onRestore: () => void;
}

/** The launcher controls only; preference and focus handoff stay in GlobalAssistant. */
export default function AssistantLauncher({
  retracted, chatOpen, badgeCount, launcherButtonRef, edgeLauncherButtonRef,
  onLauncherClick, onRetract, onRestore,
}: Props) {
  if (retracted && !chatOpen) {
    return (
      <Badge count={badgeCount} overflowCount={9} size="small">
        <Button
          ref={edgeLauncherButtonRef}
          htmlType="button"
          shape="circle"
          size="large"
          data-global-assistant="edge-launcher"
          aria-label="展开灵小枢入口"
          onClick={onRestore}
          icon={<ChevronLeft size={18} aria-hidden="true" />}
          className="!flex !h-11 !w-11 !items-center !justify-center !rounded-l-full !rounded-r-none !border-border !border-r-transparent !bg-surface !text-accent shadow-sm transition-colors hover:!border-accent/40 hover:!bg-accent-glow active:!bg-surface focus-visible:!bg-surface focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-accent focus-visible:!ring-offset-2"
          title="展开灵小枢入口"
        />
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Badge count={badgeCount} overflowCount={9} size="small">
        <Button
          ref={launcherButtonRef}
          htmlType="button"
          shape="round"
          size="large"
          data-global-assistant="launcher"
          aria-label={chatOpen ? '收起灵小枢对话' : '询问灵小枢'}
          aria-haspopup="dialog"
          aria-expanded={chatOpen}
          aria-controls="global-assistant-panel"
          onClick={onLauncherClick}
          icon={(
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white shadow-sm" style={{ background: 'var(--ls-action-gradient)' }} aria-hidden="true">
              <Bot size={15} />
            </span>
          )}
          className="!flex !h-11 !w-11 !gap-0 !border-border !bg-surface !px-2 !text-text-primary shadow-sm transition-colors hover:!border-accent/40 hover:!bg-accent-glow active:!bg-surface focus-visible:!bg-surface focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-accent focus-visible:!ring-offset-2 sm:!w-auto sm:!gap-2 sm:!px-3.5"
          title={chatOpen ? '收起灵小枢对话' : '询问灵小枢'}
        >
          <span className="ls-type-label-large hidden whitespace-nowrap sm:inline">询问灵小枢</span>
        </Button>
      </Badge>
      {!chatOpen && (
        <Button
          htmlType="button"
          shape="circle"
          size="large"
          data-global-assistant="retract-control"
          aria-label="收起灵小枢入口到右侧"
          onClick={onRetract}
          icon={<ChevronRight size={18} aria-hidden="true" />}
          className="!flex !h-11 !w-11 !items-center !justify-center !border-border !bg-surface !text-text-secondary shadow-sm transition-colors hover:!border-accent/40 hover:!bg-accent-glow hover:!text-accent focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-accent focus-visible:!ring-offset-2"
          title="收起灵小枢入口到右侧"
        />
      )}
    </div>
  );
}
