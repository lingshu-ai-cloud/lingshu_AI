import { productIdentity } from '../digitalEmployees/contentProductionPlanning.js';
import fs from 'fs';
import path from 'path';
import ffmpegStatic from 'ffmpeg-static';
import { readTenantEnterpriseProfile } from './enterprise.js';
import { store } from '../storage/index.js';
import { type ReferenceImage } from '../lib/imageGen.js';
import { type StoryboardShotSpec } from '../../shared/storyboardShotSpec.js';
import { applyStoryboardReplicationAutomation, automaticManagedFallbackVideoAdmission, buildStoryboardQaReport, inspectStoryboardTechnicalFrames, reviewStoryboardQaReport, type StoryboardQaReport } from '../lib/storyboardAigcQuality.js';
import { CONTROLLED_PRODUCT_FRAME_SOURCE } from '../lib/controlledProductImageAnimation.js';
import { storyboardAigcMetrics } from '../lib/storyboardAigcMetrics.js';
import { storyboardProjectShotInput } from '../lib/storyboardProjectShotInput.js';
import { inspectStoryboardAigcFramesWithQwen, qualityCheckStoryboardFramesWithQwen } from '../agents/qwen.js';
import { type AuthLocals } from '../middleware/auth.js';
import { objectStorageDownload } from '../storage/objectStorage.js';
import { GENERATED_MEDIA_DIR, MEDIA_DIR } from '../studio/runtimeConfig.js';
import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioStoryboardQualityRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'loadMaterials' | 'execFileAsync' | 'persistMaterials' | 'storyboardEnterpriseImage' | 'storyboardKbProductViewReferences' | 'storyboardPersonFrameVersionIssues' | 'storyboardPersonAssetImage' | 'storyboardEnvironmentFrameVersionIssues' | 'storyboardMaterialImage'>) {
  const studioRouter = deps.studioRouter;
  const loadMaterials: StudioApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);
  const execFileAsync: StudioApplicationPorts['execFileAsync'] = (...args) => deps.execFileAsync(...args);
  const persistMaterials: StudioApplicationPorts['persistMaterials'] = (...args) => deps.persistMaterials(...args);
  const storyboardEnterpriseImage: StudioApplicationPorts['storyboardEnterpriseImage'] = (...args) => deps.storyboardEnterpriseImage(...args);
  const storyboardKbProductViewReferences: StudioApplicationPorts['storyboardKbProductViewReferences'] = (...args) => deps.storyboardKbProductViewReferences(...args);
  const storyboardPersonFrameVersionIssues: StudioApplicationPorts['storyboardPersonFrameVersionIssues'] = (...args) => deps.storyboardPersonFrameVersionIssues(...args);
  const storyboardPersonAssetImage: StudioApplicationPorts['storyboardPersonAssetImage'] = (...args) => deps.storyboardPersonAssetImage(...args);
  const storyboardEnvironmentFrameVersionIssues: StudioApplicationPorts['storyboardEnvironmentFrameVersionIssues'] = (...args) => deps.storyboardEnvironmentFrameVersionIssues(...args);
  const storyboardMaterialImage: StudioApplicationPorts['storyboardMaterialImage'] = (...args) => deps.storyboardMaterialImage(...args);

  function registerPostStoryboardQualityCheck() {
    studioRouter.post('/storyboard-quality-check', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const { materialId = '', storyboard = '', productInfo = '', critical = false } = req.body ?? {};
      const material = loadMaterials().find(item => item.id === String(materialId) && (item.scope === 'shared' || item.tenantId === tenantId));
      if (!material || material.type !== 'video' || !material.file) {
        res.status(404).json({ ok: false, error: '找不到可质检的本地视频素材' });
        return;
      }
      fs.mkdirSync(GENERATED_MEDIA_DIR, { recursive: true });
      const cosTempPath = material.objectKey ? path.join(GENERATED_MEDIA_DIR, `quality-source-${material.id}${path.extname(material.file) || '.mp4'}`) : '';
      const filePath = cosTempPath || path.join(MEDIA_DIR, material.file);
      if (material.objectKey) {
        const downloaded = await objectStorageDownload(material.objectKey);
        if (downloaded?.buf.length) fs.writeFileSync(filePath, downloaded.buf);
      }
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ ok: false, error: '质检视频文件不存在' });
        return;
      }
      const tempDir = fs.mkdtempSync(path.join(GENERATED_MEDIA_DIR, 'quality-'));
      try {
        const isStoryboardAigc = material.tenantId === tenantId && material.provenance?.storyboardAigc === true;
        const sampleCount = isStoryboardAigc ? 8 : 5;
        const sampleInterval = isStoryboardAigc ? Math.max(4, material.duration || 4) / sampleCount : 2;
        const framePattern = path.join(tempDir, 'frame-%02d.jpg');
        await execFileAsync(String(ffmpegStatic), [
          '-hide_banner', '-loglevel', 'error', '-i', filePath,
          '-vf', `fps=${1 / sampleInterval},scale=640:-2`, '-frames:v', String(sampleCount), '-q:v', '4', framePattern,
        ], 90_000);
        const frameNames = fs.readdirSync(tempDir)
          .filter(name => /^frame-\d+\.jpg$/i.test(name))
          .sort()
          .slice(0, sampleCount);
        const frames = frameNames.map((name, index) => ({ base64: fs.readFileSync(path.join(tempDir, name)).toString('base64'), mimeType: 'image/jpeg', timeLabel: `${Number((index * sampleInterval).toFixed(2))}s` }));
        if (!frames.length) throw new Error('没有提取到可分析画面');
        if (isStoryboardAigc) {
          const shotSpec = material.provenance?.shotSpec as StoryboardShotSpec | undefined;
          const firstFrame = loadMaterials().find(item => item.id === material.provenance?.firstFrameMaterialId && item.tenantId === tenantId
            && (item.sourceType === 'ai-storyboard-first-frame'
              || material.provenance?.controlledProductImageAnimation === true && item.sourceType === CONTROLLED_PRODUCT_FRAME_SOURCE));
          if (!shotSpec || !firstFrame || material.provenance?.firstFrameFingerprint !== firstFrame.provenance?.fingerprint) {
            res.status(409).json({ ok: false, code: 'STORYBOARD_SOURCE_CHANGED', error: '首帧版本或分镜规格无法核验，请重新生成候选' }); return;
          }
          const currentProject = await store.getById<any>('studio_projects', String(material.provenance?.projectId || ''));
          const currentInput = currentProject?.tenant_id === tenantId
            ? storyboardProjectShotInput(currentProject.spec ?? {}, String(material.provenance?.shotId || '')) : null;
          if (!currentInput || currentInput.fingerprint !== firstFrame.provenance?.projectShotFingerprint) {
            res.status(409).json({ ok: false, code: 'STORYBOARD_PROJECT_INPUT_CHANGED', error: '当前分镜输入已变化，请重新生成候选' }); return;
          }
          const currentSourcePlan = currentProject.spec?.storyboardSourcePlans?.[String(material.provenance?.shotId || '')] as Record<string, any> | undefined;
          const existingQuality = material.provenance?.storyboardQualityReport as StoryboardQaReport | undefined;
          if (existingQuality && automaticManagedFallbackVideoAdmission(material.provenance, currentSourcePlan)) {
            const quality = applyStoryboardReplicationAutomation(existingQuality);
            const materials = loadMaterials();
            const own = materials.find(item => item.id === material.id && item.tenantId === tenantId);
            if (own) { own.provenance = { ...own.provenance, storyboardQualityReport: quality }; persistMaterials(materials); }
            res.json({ ok: true, quality, reused: true }); return;
          }
          const productImages: Array<ReferenceImage & { timeLabel: string }> = [];
          const qaProductIds = Array.isArray(firstFrame.provenance?.productIds)
            ? firstFrame.provenance.productIds.map(String) : firstFrame.productId ? [firstFrame.productId] : [];
          if (qaProductIds.length) {
            const profile = await readTenantEnterpriseProfile(tenantId);
            for (const [index, productId] of qaProductIds.entries()) {
              const profileProducts = profile.products.items || [];
              let item = profileProducts.find((product, productIndex) => productIdentity(product, productIndex) === productId);
              if (!item) {
                const legacy = productId.match(/^product-(\d+)-(.+)$/);
                const candidate = legacy ? profileProducts[Number(legacy[1])] : undefined;
                if (candidate && candidate.name === legacy?.[2] && profileProducts.filter(product => product.name === candidate.name).length === 1) item = candidate;
              }
              const imageUrl = String(item?.images?.[0]?.url || item?.imageUrl || '');
              const image = imageUrl ? await storyboardEnterpriseImage(imageUrl, tenantId) : null;
              if (image) productImages.push({ ...image, timeLabel: `企业产品参考${index + 1}：${String(item?.name || '')}` });
            }
          }
          if (shotSpec.constraints.includes('product_identity') && productImages.length !== qaProductIds.length) {
            res.status(422).json({ ok: false, code: 'PRODUCT_REFERENCE_UNAVAILABLE', error: '知识库产品参考图已失效，请补充资产后重新质检' }); return;
          }
          const qaViewAssets = shotSpec.assets.filter(asset => asset.role === 'product_view');
          const qaViewReferences = await storyboardKbProductViewReferences(tenantId, shotSpec);
          if (qaViewReferences.length !== qaViewAssets.length) {
            res.status(422).json({ ok: false, code: 'PRODUCT_VIEW_CHANGED', error: '产品多角度参考图已变化，请重新生成候选' }); return;
          }
          productImages.push(...qaViewReferences);
          const personAsset = shotSpec.assets.find(asset => asset.role === 'person');
          const personIssues = await storyboardPersonFrameVersionIssues(tenantId, shotSpec);
          if (personIssues.length) {
            res.status(409).json({ ok: false, code: 'STORYBOARD_PERSON_IMAGE_CHANGED', error: personIssues.join('；') }); return;
          }
          const personReference = personAsset ? await storyboardPersonAssetImage(personAsset.id, tenantId) : null;
          if (personAsset && !personReference) {
            res.status(422).json({ ok: false, code: 'PERSON_REFERENCE_UNAVAILABLE', error: '指定人物参考图已失效，请补充资产后重新质检' }); return;
          }
          const environmentIssues = await storyboardEnvironmentFrameVersionIssues(tenantId, currentProject.spec ?? {}, shotSpec);
          if (environmentIssues.length) {
            res.status(409).json({ ok: false, code: 'STORYBOARD_ENVIRONMENT_IMAGE_CHANGED', error: environmentIssues.join('；') }); return;
          }
          const environmentAsset = shotSpec.assets.find(asset => asset.role === 'environment');
          const environmentReference = environmentAsset ? await storyboardMaterialImage(environmentAsset.id, tenantId) : null;
          if (environmentAsset && !environmentReference) {
            res.status(422).json({ ok: false, code: 'ENVIRONMENT_REFERENCE_UNAVAILABLE', error: '工厂环境参考图已失效，请补充资产后重新质检' }); return;
          }
          const evidenceFrameLabels = frames.map(item => item.timeLabel);
          let observations: unknown = [];
          try {
            observations = await inspectStoryboardAigcFramesWithQwen({
              phase: 'video', sceneType: shotSpec.scene, frames,
              productReferences: productImages,
              personReferences: personReference ? [{ ...personReference, timeLabel: '企业人物参考' }] : [],
              environmentReferences: environmentReference && !(shotSpec.mode === 'replication' && !shotSpec.constraints.includes('person_identity')) ? [{ ...environmentReference, timeLabel: '企业工厂环境参考' }] : [],
              storyboard: shotSpec.description, productInfo: firstFrame.productName || '',
              startState: shotSpec.action.startState, beats: shotSpec.action.beats, endState: shotSpec.action.endState,
            });
          } catch (qualityError) {
            console.warn('[studio] storyboard video automated QA unavailable:', qualityError);
          }
          const technical = await inspectStoryboardTechnicalFrames('video', frameNames.map((name, index) => ({ bytes: fs.readFileSync(path.join(tempDir, name)), timeLabel: evidenceFrameLabels[index] })));
          let quality = buildStoryboardQaReport({
            phase: 'video', sceneType: shotSpec.scene,
            hasProduct: shotSpec.constraints.includes('product_identity'),
            hasNamedPerson: shotSpec.constraints.includes('person_identity'),
            hasEnvironmentReference: !!environmentReference,
            hasContact: shotSpec.constraints.includes('physical_contact'),
            hasAction: !!(shotSpec.action.beats.length || shotSpec.action.endState),
            observations: [...(Array.isArray(observations) ? observations : []).filter(item => !technical.some(check => check.key === item?.key)), ...technical],
            evidenceFrameLabels,
          });
          if (shotSpec.mode === 'replication' && !shotSpec.constraints.includes('person_identity')) quality = applyStoryboardReplicationAutomation(quality);
          if (automaticManagedFallbackVideoAdmission({ ...material.provenance, storyboardQualityReport: quality }, currentSourcePlan)) {
            quality = applyStoryboardReplicationAutomation(quality);
          }
          const materials = loadMaterials();
          const own = materials.find(item => item.id === material.id && item.tenantId === tenantId);
          if (own) { own.provenance = { ...own.provenance, storyboardQualityReport: quality }; persistMaterials(materials); }
          res.json({ ok: true, quality }); return;
        }
        const parsed = await qualityCheckStoryboardFramesWithQwen({
          frames,
          storyboard: String(storyboard),
          productInfo: String(productInfo),
          critical: Boolean(critical),
        });
        const score = parsed.score;
        res.json({
          ok: true,
          quality: {
            score,
            passed: Boolean(parsed.passed) && score >= (critical ? 85 : 75),
            issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 8).map(String) : [],
            strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 6).map(String) : [],
            recommendation: String(parsed.recommendation || ''),
            checks: parsed.checks && typeof parsed.checks === 'object' ? parsed.checks : {},
            checkedAt: new Date().toISOString(),
          },
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error instanceof Error ? error.message : '分镜质检失败' });
      } finally {
        try {
          for (const name of fs.readdirSync(tempDir)) fs.unlinkSync(path.join(tempDir, name));
          fs.rmdirSync(tempDir);
        } catch { /* best effort */ }
        if (cosTempPath) fs.rmSync(cosTempPath, { force: true });
      }
    });
  }

  function registerPostStoryboardQualityCheckMaterialIdReview() {
    studioRouter.post('/storyboard-quality-check/:materialId/review', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const { shotId, reportId, decision } = req.body ?? {};
      if (decision !== 'accept' && decision !== 'reject') { res.status(400).json({ ok: false, error: '复核决定无效' }); return; }
      const materials = loadMaterials();
      const material = materials.find(item => item.id === req.params.materialId && item.tenantId === tenantId && item.provenance?.storyboardAigc === true);
      const report = material?.provenance?.storyboardQualityReport as StoryboardQaReport | undefined;
      if (!material || !report || report.reportId !== String(reportId) || material.provenance?.shotId !== String(shotId)) {
        res.status(409).json({ ok: false, error: '视频候选或质检报告已变化，请重新检查' }); return;
      }
      const firstFrame = materials.find(item => item.id === material.provenance?.firstFrameMaterialId && item.tenantId === tenantId);
      const currentProject = await store.getById<any>('studio_projects', String(material.provenance?.projectId || ''));
      const currentInput = currentProject?.tenant_id === tenantId ? storyboardProjectShotInput(currentProject.spec ?? {}, String(shotId)) : null;
      if (!firstFrame || !currentInput || currentInput.fingerprint !== firstFrame.provenance?.projectShotFingerprint) {
        res.status(409).json({ ok: false, code: 'STORYBOARD_PROJECT_INPUT_CHANGED', error: '当前分镜输入已变化，请重新生成候选' }); return;
      }
      if (report.reviewDecision === decision) { res.json({ ok: true, quality: report }); return; }
      try {
        const quality = reviewStoryboardQaReport(report, { decision, reviewedBy: userId });
        material.provenance = { ...material.provenance, storyboardQualityReport: quality };
        persistMaterials(materials);
        res.json({ ok: true, quality });
      } catch (error) {
        res.status(409).json({ ok: false, error: error instanceof Error ? error.message : '质检复核失败', quality: report });
      }
    });
  }

  function registerGetStoryboardAigcMetrics() {
    studioRouter.get('/storyboard-aigc-metrics', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const projectId = String(req.query.projectId || '').trim();
      if (!projectId) { res.status(400).json({ ok: false, error: '缺少分镜项目 ID' }); return; }
      const project = await store.getById<any>('studio_projects', projectId);
      if (!project || project.tenant_id !== tenantId) { res.status(404).json({ ok: false, error: '分镜项目不存在' }); return; }
      const materials = loadMaterials().filter(item => item.tenantId === tenantId && item.provenance?.projectId === projectId);
      const adopted = Object.values(project.spec?.storyboardAssignments || {}).map(String);
      res.json({ ok: true, projectId, metrics: storyboardAigcMetrics(materials, adopted) });
    });
  }

  return { registerPostStoryboardQualityCheck, registerPostStoryboardQualityCheckMaterialIdReview, registerGetStoryboardAigcMetrics };
}
