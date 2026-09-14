import assert from 'node:assert/strict';
import { SOCIAL_CONTENT_FILE_ACCEPT, socialContentMimeForFileName, validateSocialContentFile } from './socialContentFiles.js';

assert.equal(validateSocialContentFile({ name: '产品图.jpg', size: 1024, type: 'image/jpeg' }), null);
assert.equal(validateSocialContentFile({ name: '说明.docx', size: 1024, type: '' }), null);
assert.match(validateSocialContentFile({ name: '演示.pptx', size: 1024, type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }) || '', /格式暂不支持/);
assert.match(validateSocialContentFile({ name: '产品图.jpg', size: 1024, type: 'image/png' }) || '', /不匹配/);
assert.match(validateSocialContentFile({ name: '大文件.mp4', size: 111 * 1024 * 1024, type: 'video/mp4' }) || '', /110 MB/);
assert.ok(SOCIAL_CONTENT_FILE_ACCEPT.includes('.docx'));
assert.ok(!SOCIAL_CONTENT_FILE_ACCEPT.includes('.pptx'));
assert.equal(socialContentMimeForFileName('数据.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

console.log('social content file validation tests passed');
