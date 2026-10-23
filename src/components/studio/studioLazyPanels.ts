import { lazy } from 'react';

export const StudioReviewIssueActions = lazy(() => import('./StudioReviewIssueActions'));

export const ShotMaterialLibraryDialog = lazy(() => import('./ShotMaterialLibraryDialog'));

export const AgentTaskDemoWorkbench = lazy(() => import('../socialContent/AgentTaskDemoWorkbench'));

export const ProjectsOverlay = lazy(() => import('./StudioProjectsOverlay'));

export const ExistingSourceDraftDialog = lazy(() => import('./ExistingSourceDraftDialog'));

export const ShotProductionPanel = lazy(() => import('../ShotProductionPanel'));

export const StudioBatchReviewDialog = lazy(() => import('./StudioBatchReviewDialog'));

export const BenchmarkVideoPreview = lazy(() => import('./StudioPreviewPanels').then(module => ({ default: module.BenchmarkVideoPreview })));

export const LeadContentPackagePreview = lazy(() => import('./StudioPreviewPanels').then(module => ({ default: module.LeadContentPackagePreview })));
