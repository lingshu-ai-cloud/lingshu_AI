import { type BoundProductionSlot } from '../../lib/socialSceneReworkNavigation';
import { type StudioWorkflowContext } from '../../lib/studioProjectContext';
import { useAgentProductionAction } from '../../lib/agentProductionSession';
import { useRef, useState } from 'react';
import { type StudioProject } from '../../lib/studioApi';
import type { SocialContentCreateRequest } from '../socialContent/SocialContentWorkspace';
import type { ExistingSourceDraftPrompt } from './studioWorkspaceContracts.js';
import type { StudioProjectLifecyclePorts } from './studioProjectLifecyclePorts.js';

export function useStudioProjectFrozenState() {

  const [boundProductionSnapshot,setBoundProductionSnapshot]=useState<{projectId:string;slots:BoundProductionSlot[]}|null>(null);
  const frozenStudioSpecRef = useRef<Record<string, unknown> | null>(null);

  return { boundProductionSnapshot, setBoundProductionSnapshot, frozenStudioSpecRef };
}

export function useStudioProjectEntryState() {

  const [restoredSocialTaskId, setRestoredSocialTaskId] = useState<string | null>(null);
  const [restoredCreateRequest, setRestoredCreateRequest] = useState<SocialContentCreateRequest | null>(null);

  return { restoredSocialTaskId, setRestoredSocialTaskId, restoredCreateRequest, setRestoredCreateRequest };
}

export function useStudioProjectRevisionState() {

  const projectRevisionRef = useRef<string | undefined>(undefined);
  const projectRevisionProjectIdRef = useRef<string | undefined>(undefined);
  const projectSaveConflictRef = useRef<{ project: StudioProject; localSpec: Record<string, unknown> } | null>(null);

  return { projectRevisionRef, projectRevisionProjectIdRef, projectSaveConflictRef };
}

export function useStudioProjectIdentityState(ports: Pick<StudioProjectLifecyclePorts,
  | 'socialContentTaskId'
  | 'workflowContext'
>) {
  const {
    socialContentTaskId, workflowContext,
  } = ports;

  const [projectId, setProjectId] = useState<string | null>(null);
  const [socialTaskProjectLookupDone, setSocialTaskProjectLookupDone] = useState(() => !socialContentTaskId);
  const currentProjectRef = useRef(projectId);
  currentProjectRef.current = projectId;
  const projectHydrationPendingRef = useRef(Boolean(
    socialContentTaskId || new URLSearchParams(location.search).get('project'),
  ));
  const [projectHydrationRevision, setProjectHydrationRevision] = useState(0);
  const managedProductionProjectRef = useRef(false);
  const agentProduction = useAgentProductionAction('studio');
  const [projectWorkflowContext, setProjectWorkflowContext] = useState<StudioWorkflowContext | null>(workflowContext || null);
  const generationSessionId = useRef(`session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  return { projectId, setProjectId, socialTaskProjectLookupDone, setSocialTaskProjectLookupDone, currentProjectRef, projectHydrationPendingRef, projectHydrationRevision, setProjectHydrationRevision, managedProductionProjectRef, agentProduction, projectWorkflowContext, setProjectWorkflowContext, generationSessionId };
}

export function useStudioProjectTitleState() {

  const [projectTitle, setProjectTitle] = useState('未命名草稿');

  return { projectTitle, setProjectTitle };
}

export function useStudioProjectLibraryState(ports: Pick<StudioProjectLifecyclePorts,
  | 'workflowContext'
>) {
  const {
    workflowContext,
  } = ports;

  const [showProjects, setShowProjects] = useState(false);
  const [workflowProjectSelectionPending, setWorkflowProjectSelectionPending] = useState(
    () => ['content_production', 'content_quality_gate'].includes(workflowContext?.taskKey || ''),
  );
  const projectsPanelWasOpenRef = useRef(false);
  const handledOpenProjectsSignalRef = useRef(0);
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [savingProj, setSavingProj] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [autosaveError, setAutosaveError] = useState('');
  const [lastAutosavedAt, setLastAutosavedAt] = useState<Date | null>(null);
  const autosaveInFlightRef = useRef(false);
  const projectDeleteInFlightRef = useRef<string | null>(null);
  const autosavePendingRef = useRef(false);
  const autosaveSnapshotRef = useRef<() => Promise<void>>(async () => undefined);
  const lastSavedAutosaveFingerprintRef = useRef('');

  return { showProjects, setShowProjects, workflowProjectSelectionPending, setWorkflowProjectSelectionPending, projectsPanelWasOpenRef, handledOpenProjectsSignalRef, projects, setProjects, savingProj, setSavingProj, savedTick, setSavedTick, autosaveStatus, setAutosaveStatus, autosaveError, setAutosaveError, lastAutosavedAt, setLastAutosavedAt, autosaveInFlightRef, projectDeleteInFlightRef, autosavePendingRef, autosaveSnapshotRef, lastSavedAutosaveFingerprintRef };
}

export function useStudioProjectSourcePromptState() {

  const [sourceDraftCheckPending, setSourceDraftCheckPending] = useState(true);
  const [existingSourceDraftPrompt, setExistingSourceDraftPrompt] = useState<ExistingSourceDraftPrompt | null>(null);

  return { sourceDraftCheckPending, setSourceDraftCheckPending, existingSourceDraftPrompt, setExistingSourceDraftPrompt };
}
