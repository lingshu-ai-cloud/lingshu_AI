import { analyzeMaterialVideo } from '../studio/materialVideoAnalysis.js';
import { materialResponse, type Material } from './studioMaterialProjection.js';
import { analysisDetailsTimelineQuality } from './studioReferenceTimelineQuality.js';
import { waitForMaterialAnalysis } from '../lib/materialLibraryAnalysis.js';
import { readMaterialLibrary, updateLocalMaterial } from '../lib/materialLibrary.js';
import fs from 'fs';
import path from 'path';
import os from 'node:os';
import { fetchCloudMaterial, getOwnedCloudMaterialRecord, updateCloudMaterial } from '../lib/cloudMaterials.js';
import { analyzeVideo } from '../agents/gemini.js';
import { analysisDetailToSegment, type MaterialSegment } from './studioMaterialAnalysisSegments.js';
import { analyzeVideoFramesWithQwen, classifyMaterialFramesWithQwen } from '../agents/qwen.js';
import { extractQwenAnalysisFrames } from './videos.js';
import { type AuthLocals } from '../middleware/auth.js';
import { objectStorageDownload } from '../storage/objectStorage.js';
import { MEDIA_DIR } from '../studio/runtimeConfig.js';
import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioMaterialAnalysisRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter'>) {
  const studioRouter = deps.studioRouter;



  async function analyzeCloudMaterialSegments(pbId: string, tenantId: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const record = await getOwnedCloudMaterialRecord(pbId, tenantId);
    if (!record) return { status: 404, body: { ok: false, error: 'Material not found' } };
    if (String(record.type || 'video') !== 'video') {
      return { status: 400, body: { ok: false, error: '仅视频素材支持片段分析' } };
    }

    await updateCloudMaterial(pbId, { segmentAnalysisStatus: 'analyzing', segmentAnalysisError: '' });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-material-analysis-'));
    const tempPath = path.join(tempDir, `material-${pbId}.mp4`);
    try {
      const media = await fetchCloudMaterial(pbId, 'videoFile', undefined, tenantId);
      if (!media?.ok) throw new Error('云端素材文件不可读');
      const buffer = Buffer.from(await media.arrayBuffer());
      if (!buffer.length) throw new Error('云端素材文件为空');
      fs.writeFileSync(tempPath, buffer);

      const analysis = await analyzeMaterialVideo(tempPath, buffer, Number(record.duration || 0));
      const details = analysis.scriptDetails15s || [];
      if (!details.length) throw new Error('模型未返回可用的片段时间轴');

      // analysisDetailToSegment 只用到 id 与 duration，构造最小对象即可。
      const material = { id: `pb-${pbId}`, duration: Number(record.duration || 0) } as Material;
      const segments: MaterialSegment[] = [];
      let fallbackStart = 0;
      for (let index = 0; index < details.length; index++) {
        const segment = analysisDetailToSegment(material, details[index]!, index, fallbackStart);
        // Segment metadata is durable; derivative frames are intentionally not
        // mirrored into the application server's data/media directory. The UI
        // can use the material's database-backed poster until PB gains a
        // dedicated multi-file field for per-segment thumbnails.
        segments.push(segment);
        fallbackStart = segment.end;
      }

      const saved = await updateCloudMaterial(pbId, { segments, segmentAnalysisStatus: 'completed', segmentAnalysisError: '' });
      if (!saved) throw new Error('片段写回云端失败');
      return { status: 200, body: { ok: true, materialId: material.id, segments } };
    } catch (error: any) {
      const message = String(error?.message || error || '片段分析失败').slice(0, 500);
      await updateCloudMaterial(pbId, { segmentAnalysisStatus: 'failed', segmentAnalysisError: message });
      return { status: 500, body: { ok: false, error: message } };
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  function registerPostMaterialsIdAnalyzeSegments() {
    studioRouter.post('/materials/:id/analyze-segments', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      try {
        const material = await waitForMaterialAnalysis(tenantId, req.params.id);
        const responseMaterial = await materialResponse(material as Material, tenantId);
        res.json({ ok: true, material: responseMaterial, segments: responseMaterial.segments });
      } catch (error) {
        res.status(409).json({ ok: false, error: error instanceof Error ? error.message : '素材分析失败' });
      }
    });
  }

  function registerPostMaterialsIdClassify() {
    studioRouter.post('/materials/:id/classify', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const inventory = await readMaterialLibrary(tenantId);
      const material = inventory.items.find(item => item.id === req.params.id && item.tenantId === tenantId && item.scope !== 'shared') as Material | undefined;
      if (!material) { res.status(404).json({ ok: false, error: 'Material not found' }); return; }
      if (material.type !== 'video') { res.status(400).json({ ok: false, error: '仅视频素材支持智能分类' }); return; }
      const cloudId = material.id.startsWith('pb-') ? material.id.slice(3) : '';
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-material-classify-'));
      const mediaPath = cloudId || material.objectKey
        ? path.join(tempDir, `classify${path.extname(material.file) || '.mp4'}`)
        : path.join(MEDIA_DIR, material.file);
      try {
        if (cloudId) {
          const downloaded = await fetchCloudMaterial(cloudId, 'videoFile', undefined, tenantId);
          if (!downloaded?.ok) throw new Error('素材数据库中的原片不可读');
          fs.writeFileSync(mediaPath, Buffer.from(await downloaded.arrayBuffer()), { mode: 0o600 });
        } else if (material.objectKey) {
          const downloaded = await objectStorageDownload(material.objectKey);
          if (!downloaded?.buf.length) throw new Error('COS 素材文件不存在');
          fs.writeFileSync(mediaPath, downloaded.buf, { mode: 0o600 });
        }
        const frames = await extractQwenAnalysisFrames(mediaPath, 8, material.duration);
        const classified = await classifyMaterialFramesWithQwen({ name: material.name, frames });
        material.industry = classified.industry;
        material.applicability = classified.applicability;
        material.shotFunction = classified.shotFunctions.join(',');
        material.tags = classified.tags.join(',');
        const changes = { industry: material.industry, applicability: material.applicability, shotFunction: material.shotFunction, tags: material.tags };
        const saved = cloudId ? await updateCloudMaterial(cloudId, changes) : updateLocalMaterial(material.id, tenantId, changes);
        if (!saved) throw new Error('素材分类写回失败');
        res.json({ ok: true, material: await materialResponse(material, tenantId) });
      } catch (error) {
        res.status(500).json({ ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 500) });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  }

  return { analyzeMaterialVideo, registerPostMaterialsIdAnalyzeSegments, registerPostMaterialsIdClassify };
}
