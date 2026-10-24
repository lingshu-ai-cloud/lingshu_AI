import { Switch } from 'antd';
import { useId } from 'react';

/** Presentation only; activation and confirmation remain owned by the workbench. */
export default function CustomerServiceSwitch({ enabled, unavailable, saving, summary, onChange }: {
  enabled: boolean;
  unavailable: boolean;
  saving: boolean;
  summary: string;
  onChange: (enabled: boolean) => void;
}) {
  const switchId = useId();
  const descriptionId = `${switchId}-description`;
  return <label htmlFor={switchId} className="mb-2 flex min-h-11 items-center justify-between gap-2 text-xs text-text-secondary">
    <span title={summary}>智能客服</span>
    <span id={descriptionId} className="sr-only">{summary}</span>
    <Switch id={switchId} size="small" aria-label="智能客服总开关" aria-describedby={descriptionId}
      checked={enabled} disabled={unavailable} loading={saving}
      onChange={value => { if (!unavailable && !saving) onChange(value); }} />
  </label>;
}
