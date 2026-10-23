import { restoreStudioBoundaryComposition } from './studioBoundaryComposition';

const moduleNames = [
  'studioProjectSnapshot.ts', 'studioProjectRestoration.ts',
  'studioProjectPersistence.tsx', 'studioProjectWorkspaceActions.ts',
  'useStudioProjectState.ts', 'useStudioProjectEntryLifecycle.ts',
  'useStudioProjectNavigationLifecycle.ts', 'useStudioProjectAutosave.ts',
];


export function restoreStudioProjectComposition(source: string): string {
  return restoreStudioBoundaryComposition(source, {
    moduleNames, portBinding: 'projectPorts',
    actionFactories: ['createStudioProjectRestoration', 'createStudioProjectPersistence', 'createStudioProjectWorkspaceActions'],
    lexicalDefaults: ['coverUrl'],
  });
}
