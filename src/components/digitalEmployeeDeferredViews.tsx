import { lazy } from 'react';

export const SmartBusinessDashboard = lazy(() => import('./SmartBusinessDashboard'));
export const WeeklyCommandCenter = lazy(() => import('./SmartBusinessDashboard').then(module => ({ default: module.WeeklyCommandCenter })));
export const WeeklyPlanDetailsDrawer = lazy(() => import('./SmartBusinessDashboard').then(module => ({ default: module.WeeklyPlanDetailsDrawer })));
export const BusinessInterpretation = lazy(() => import('./SmartBusinessDashboard').then(module => ({ default: module.BusinessInterpretation })));
export const WeeklyReviewPanel = lazy(() => import('./WeeklyReviewPanel'));
export const deferredWorkspaceFallback = <div role="status" className="p-5 text-sm text-text-muted">正在加载工作区…</div>;
