import { userBgms, withRecommendedBgmNames } from '../routes/studioBgmCatalog.js';
import { buildStudioRenderManifest, type RenderManifest, type RenderSpec } from '../routes/studioRenderManifestProjection.js';
import type { StudioEmphasisPreanalysis } from '../lib/studioEmphasisAlignment.js';
import { studioBgmMediaPath } from '../lib/studioBgmAccess.js';

import type { StudioApplicationPorts } from './applicationPorts.js';

export function createRenderManifestApplication(deps: Pick<StudioApplicationPorts, 'studioTenantContext' | 'loadMaterials'>) {
  const studioTenantContext = deps.studioTenantContext;
  const loadMaterials: StudioApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);

  function buildManifest(jobId: string, spec: RenderSpec, base: string, emphasisPreanalysis?: StudioEmphasisPreanalysis): RenderManifest {
    // 选中素材按名称映射到素材库的真实 URL（已上传的给绝对地址，ffmpeg 可直接拉取）
    const tenantId = studioTenantContext.getStore();
    const urlByName = new Map(loadMaterials()
      .filter(m => m.scope === 'shared' || (tenantId && m.tenantId === tenantId))
      .map(m => [m.name, m.url]));
    const track = spec.bgm && tenantId ? withRecommendedBgmNames(userBgms(tenantId)).find(t => t.id === spec.bgm) : null;
    const bgmUrl = track && tenantId ? studioBgmMediaPath(track, tenantId) : null;
    return buildStudioRenderManifest({ jobId, spec, base, materialUrlByName: urlByName,
      bgmUrl, emphasisPreanalysis });
  }

  return { buildManifest };
}
