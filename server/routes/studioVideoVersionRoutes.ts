import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { type AuthLocals } from '../middleware/auth.js';
import { VIDEO_VERSIONS_FILE } from '../studio/runtimeConfig.js';
import type { VideoGenerationVersion } from '../studio/contracts.js';
import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioVideoVersionRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter'>) {
  const studioRouter = deps.studioRouter;

  function loadVideoVersions(): VideoGenerationVersion[] {
    try { return JSON.parse(fs.readFileSync(VIDEO_VERSIONS_FILE, 'utf8')) as VideoGenerationVersion[]; }
    catch { return []; }
  }

  function persistVideoVersions(list: VideoGenerationVersion[]): void {
    fs.mkdirSync(path.dirname(VIDEO_VERSIONS_FILE), { recursive: true });
    fs.writeFileSync(VIDEO_VERSIONS_FILE, JSON.stringify(list, null, 2), 'utf8');
  }

  function appendVideoVersion(input: Omit<VideoGenerationVersion, 'id' | 'versionNumber' | 'isSelected' | 'createdAt'>): VideoGenerationVersion {
    const list = loadVideoVersions();
    const siblings = list.filter(item => item.tenantId === input.tenantId && item.groupKey === input.groupKey);
    siblings.forEach(item => { item.isSelected = false; });
    const version: VideoGenerationVersion = {
      ...input,
      id: randomUUID(),
      versionNumber: Math.max(0, ...siblings.map(item => item.versionNumber)) + 1,
      isSelected: true,
      createdAt: new Date().toISOString(),
    };
    list.push(version);
    persistVideoVersions(list);
    return version;
  }

  function registerGetVideoVersions() {
    studioRouter.get('/video-versions', (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const groupKey = String(req.query.groupKey || '').trim();
      const projectId = String(req.query.projectId || '').trim();
      if (!groupKey && !projectId) { res.status(400).json({ error: 'groupKey or projectId is required' }); return; }
      const versions = loadVideoVersions()
        .filter(item => item.tenantId === tenantId)
        .filter(item => groupKey ? item.groupKey === groupKey : String(item.context?.projectId || '') === projectId)
        .sort((a, b) => b.versionNumber - a.versionNumber);
      res.json(versions);
    });
  }

  function registerPatchVideoVersionsIdSelect() {
    studioRouter.patch('/video-versions/:id/select', (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const list = loadVideoVersions();
      const target = list.find(item => item.id === req.params.id && item.tenantId === tenantId);
      if (!target) { res.status(404).json({ ok: false, error: 'version_not_found' }); return; }
      list.forEach(item => {
        if (item.tenantId === tenantId && item.groupKey === target.groupKey) item.isSelected = item.id === target.id;
      });
      persistVideoVersions(list);
      res.json({ ok: true, version: target });
    });
  }

  return { appendVideoVersion, registerGetVideoVersions, registerPatchVideoVersionsIdSelect };
}
