import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const studioApiSource = readFileSync(new URL('./studioApi.ts', import.meta.url), 'utf8');
const inspirationSource = readFileSync(new URL('../components/InspirationDashboard.tsx', import.meta.url), 'utf8');
const studioSource = readFileSync(new URL('../components/AiCreateStudio.tsx', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../../server/routes/studio.ts', import.meta.url), 'utf8');

assert.match(studioApiSource, /uploadMaterialFile:[\s\S]*body: file/, '本地素材必须直接发送 File，不能先转 base64');
assert.match(studioApiSource, /单个素材不能超过 110 MB/, '超限素材必须在浏览器侧给出明确提示');
assert.match(inspirationSource, /studioApi\.uploadMaterialFile\(file/, '灵感中心素材库必须走二进制文件上传');
assert.doesNotMatch(inspirationSource, /readAsDataURL/, '灵感中心不能把本地视频扩展为 data URL');

const studioUploadHandler = studioSource.match(/const handleUpload = async[\s\S]*?const generateDigitalHumanPresenter/)?.[0] || '';
assert.match(studioUploadHandler, /studioApi\.uploadMaterialFile\(f/, '内容创作素材上传必须走二进制文件上传');
assert.doesNotMatch(studioUploadHandler, /fileToDataUrl/, '内容创作素材上传不能把视频扩展为 data URL');

assert.match(serverSource, /studioRouter\.post\('\/materials\/file'[\s\S]*?await pipeline\(req, sizeLimiter/, '服务端必须以流方式接收素材文件');
assert.match(serverSource, /MATERIAL_TOO_LARGE/, '服务端流式上传必须在写盘过程中执行硬上限');

console.log('studio material streaming upload regression passed');
