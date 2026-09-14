import assert from 'node:assert/strict';
import {
  auditCommercialClaims,
  confirmedEnterpriseContextForProduct,
  hasConfirmedEnterpriseFacts,
  unconfirmedEnterpriseProductFields,
  unpublishableGenerationReasons,
} from './studio.js';

const normalizedEmptyProfile = 'Business rules: quoteMode=not_configured; priceRange=; moq=; samplePolicy=; paymentTerms=; leadTime=; bargainPolicy=; bargainFloor=';
assert.equal(hasConfirmedEnterpriseFacts(normalizedEmptyProfile), false, 'normalized defaults are not confirmed enterprise facts');
assert.equal(hasConfirmedEnterpriseFacts(`${normalizedEmptyProfile}\n公司名称：测试企业`), true);

const unsupported = auditCommercialClaims([
  'GMP / ISO9001 / FDA-ready',
  'Low MOQ and fast turnaround',
  'Worldwide export support with OEM customization',
  'Factory production line with international shipping',
  '100% quality guarantee',
].join('\n'), normalizedEmptyProfile);
assert.ok(unsupported.issues.length >= 4, unsupported.issues.join('\n'));
for (const field of ['认证资质', 'MOQ / 起订量', '交期 / 周转时间', '出口能力 / 国家', 'OEM / ODM / 私标 / 定制能力']) {
  assert.ok(unsupported.fieldsToConfirm.includes(field), `missing ${field}`);
}

const pending = auditCommercialClaims('MOQ 待确认\nGMP 待确认\n交期需确认', '公司名称：测试企业');
assert.deepEqual(pending.issues, [], 'explicit pending placeholders are drafts, not asserted facts');
assert.ok(pending.fieldsToConfirm.includes('MOQ / 起订量'));
assert.ok(pending.fieldsToConfirm.includes('认证资质'));
assert.ok(pending.fieldsToConfirm.includes('交期 / 周转时间'));

const confirmedProfile = [
  '公司名称：测试制造企业',
  '企业类型：制造工厂',
  '社媒合作路线：oem_odm',
  '起订量：100件',
  '认证资质：ISO9001',
  '交期能力：15天',
  '公司简介：外贸企业；出口能力：欧洲市场',
  '定制能力：OEM 包装定制',
  '产品优势：严格质检',
].join('\n');
assert.deepEqual(unconfirmedEnterpriseProductFields('产品名称：测试产品\n起订量：100件', `${confirmedProfile}\n产品1：测试产品`), []);
assert.deepEqual(
  unconfirmedEnterpriseProductFields('产品名称：测试产品\n认证资质：FDA-ready', `${confirmedProfile}\n产品1：测试产品`),
  ['认证资质'],
  'client-supplied product fields must not expand authenticated enterprise facts',
);
const multiProductProfile = [
  '公司名称：多产品企业',
  '产品1：产品 A；资质：CE；起订量：100件',
  '产品2：产品 B；资质：FDA-ready；起订量：20件',
].join('\n');
const selectedProductContext = confirmedEnterpriseContextForProduct('产品名称：产品 A', multiProductProfile);
assert.match(selectedProductContext, /产品1：产品 A/);
assert.doesNotMatch(selectedProductContext, /产品2：产品 B/, 'unselected product records must not enter the model fact context');
assert.deepEqual(
  unconfirmedEnterpriseProductFields('产品名称：产品 A\n认证资质：FDA-ready', multiProductProfile),
  ['认证资质'],
  'a selected product must not borrow another product certification',
);
const confirmed = auditCommercialClaims([
  '起订量：100件',
  '认证资质：ISO9001',
  '交期：15天',
  '出口能力：欧洲市场',
  'OEM 包装定制',
  '严格质检',
].join('\n'), confirmedProfile);
assert.deepEqual(confirmed.issues, [], confirmed.issues.join('\n'));
assert.deepEqual(confirmed.fieldsToConfirm, []);

assert.ok(auditCommercialClaims('ISO 13485 certified', confirmedProfile).issues.some(issue => issue.includes('ISO 13485')), 'a different ISO standard must not be treated as the confirmed ISO9001 certification');

const blockedPoster = unpublishableGenerationReasons({
  contentMode: 'poster',
  posterDraft: {
    provenance: 'template', qualityStatus: 'unreviewed', publishable: false,
    fieldsToConfirm: ['MOQ / 起订量'],
  },
});
assert.ok(blockedPoster.some(reason => reason.includes('template')));
assert.ok(blockedPoster.some(reason => reason.includes('待确认商业字段')));

const blockedScript = unpublishableGenerationReasons({
  contentMode: 'video',
  script: 'unverified historical copy',
  modeScripts: [{ script: 'unverified historical copy', generationProvenance: 'ai_failed', qualityStatus: 'failed', publishable: false }],
});
assert.ok(blockedScript.some(reason => reason.includes('ai_failed')));

assert.ok(unpublishableGenerationReasons({
  contentMode: 'video',
  script: 'legacy script without provenance',
  modeScripts: [{ script: 'legacy script without provenance' }],
}).some(reason => reason.includes('缺少明确生成来源')), 'legacy scripts without provenance must stay drafts');

assert.ok(unpublishableGenerationReasons({
  contentMode: 'poster',
  posterJsonText: '{"headline":"manual poster"}',
}).some(reason => reason.includes('海报正文缺少生成来源')), 'poster JSON without a verified draft record must stay a draft');

assert.deepEqual(unpublishableGenerationReasons({
  contentMode: 'video',
  script: 'verified generated script',
  modeScripts: [{ script: 'verified generated script', generationProvenance: 'ai', qualityStatus: 'passed', publishable: true }],
}), []);

assert.deepEqual(unpublishableGenerationReasons({
  contentMode: 'poster',
  posterDraft: { provenance: 'ai', source: 'ai', qualityStatus: 'passed', publishable: true, fieldsToConfirm: [] },
}), []);

console.log('studio generation truthfulness tests passed');
