import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVideoPlan } from './videoCreationPlan.js';

test('pre-production normalization preserves service-owned system routes', () => {
  const normalized = normalizeVideoPlan({
    route: 'product',
    productName: '精华液 A',
    theme: '成分说明',
    language: 'zh',
    duration: 30,
    platform: 'youtube',
    materialIds: [],
    referenceId: '',
    presenter: 'material',
    heygenAvatarId: '',
    avatarConsent: false,
    voice: 'v1',
    preproduction: {
      version: 1,
      status: 'blocked',
      generatedAt: '2026-10-13T00:00:00.000Z',
      benchmark: {
        status: 'not_applicable', referenceId: '', title: '', account: '', views: '',
        thumbnailUrl: '', sourceUrl: '', hook: '', shotSummary: [],
      },
      materials: {
        status: 'blocked',
        items: [{ id: 'system-shot', name: '工厂过程镜头', type: 'video', previewUrl: '', status: 'system_planned' }],
        storyboard: [{
          materialType: 'factory', materialLabel: '工厂过程', narrativeRole: 'capability_proof',
          shotIds: ['shot-1'], referenceFirstFrameUrl: '', materialId: '', materialPreviewUrl: '',
          status: 'system_planned', supplyMode: 'system_fallback',
          supplyRoute: 'licensed_stock_rewrite', supplyNote: '先使用可授权通用工厂素材并改写镜头。',
        }],
        blockers: ['系统路线尚未接入执行器'],
        pendingShootTaskIds: [],
      },
      readiness: { canStart: false, blockers: ['系统路线尚未接入执行器'] },
      confidence: { onTimeRate: null, effectLevel: 'insufficient', reasons: [] },
    },
  });

  assert.equal(normalized.preproduction?.materials.items[0]?.status, 'system_planned');
  assert.deepEqual(normalized.preproduction?.materials.storyboard?.[0], {
    materialType: 'factory', materialLabel: '工厂过程', narrativeRole: 'capability_proof',
    shotIds: ['shot-1'], referenceFirstFrameUrl: '', materialId: '', materialPreviewUrl: '',
    status: 'system_planned', supplyMode: 'system_fallback',
    supplyRoute: 'licensed_stock_rewrite', supplyNote: '先使用可授权通用工厂素材并改写镜头。',
  });
});
