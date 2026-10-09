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
  return <header className={`ls-page-header ${className}`}>
    <div className="ls-page-header__row"><div className="min-w-0">
      <Typography.Title level={1} className="ls-page-header__title">{title}</Typography.Title>
      {description && <div className="ls-page-header__description">{description}</div>}
    </div>{extra && <div className="ls-page-header__actions">{extra}</div>}</div>
    {children}
  </header>;
}

export default LsPageHeader;
