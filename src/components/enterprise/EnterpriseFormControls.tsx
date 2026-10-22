import { cloneElement, isValidElement, useId, type ReactNode } from 'react';
import { Checkbox, Form } from 'antd';

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return <Checkbox checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  return <Form.Item label={label} htmlFor={id} extra={hint} layout="vertical">
    {isValidElement<{ id?: string }>(children) ? cloneElement(children, { id }) : children}
  </Form.Item>;
}
