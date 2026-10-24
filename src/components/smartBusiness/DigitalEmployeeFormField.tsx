import type { ReactNode } from 'react';

export function Field({
  label,
  children,
  wide = false,
  required = false,
  error = "",
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  required?: boolean;
  error?: string;
}) {
  return (
    <label className={wide ? "md:col-span-2" : ""}>
      <span className="mb-1.5 block text-xs font-semibold text-text-secondary">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </span>
      {children}
      {error && (
        <span className="mt-1 block text-[10px] font-semibold text-red-600">
          {error}
        </span>
      )}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-glow";
