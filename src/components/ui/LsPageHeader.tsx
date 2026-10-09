import { Typography } from 'antd';
import type { ReactNode } from 'react';

export interface LsPageHeaderProps {
  title: string;
  description?: ReactNode;
  extra?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function LsPageHeader({ title, description, extra, children, className = '' }: LsPageHeaderProps) {
  const accessibleTitle = <Typography.Title level={1} className="sr-only">{title}</Typography.Title>;
  void description;
  if (!extra && !children) return accessibleTitle;
  return <header className={`ls-page-header ls-page-header--actions-only ${className}`}>
    {accessibleTitle}
    {extra && <div className="ls-page-header__row justify-end"><div className="ls-page-header__actions">{extra}</div></div>}
    {children}
  </header>;
}

export default LsPageHeader;
