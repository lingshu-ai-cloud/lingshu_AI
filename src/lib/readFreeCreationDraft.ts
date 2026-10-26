import type { StudioProject } from './studioApi';
/** Explicit continuation never falls back to another remembered draft. */
export async function readFreeCreationDraft(explicitId: string | undefined, storedId: string,
  reader: { getProject: (id: string) => Promise<StudioProject>; listProjects: () => Promise<StudioProject[]> }) {
  if (explicitId) {
    const project = await reader.getProject(explicitId);
    if (project.id !== explicitId || project.status !== 'draft' || !project.spec.freeCreation) throw new Error('该创作草稿暂时无法继续，请返回内容创作重新打开。');
    return project;
  }
  return storedId ? (await reader.listProjects()).find(project => project.id === storedId && project.status === 'draft' && project.spec.freeCreation) : undefined;
}
