import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./InspirationDashboard.tsx', import.meta.url), 'utf8')
  + fs.readFileSync(new URL('./inspiration/InspirationMaterialGallery.tsx', import.meta.url), 'utf8');
const watchModal = fs.readFileSync(new URL('./inspiration/InspirationWatchModal.tsx', import.meta.url), 'utf8');
const materialMediaSource = fs.readFileSync(new URL('./inspiration/MaterialLibraryCardMedia.tsx', import.meta.url), 'utf8');
const cardsSource = fs.readFileSync(new URL('./InspirationVideoCards.tsx', import.meta.url), 'utf8');
const mediaSource = fs.readFileSync(new URL('./inspiration/InspirationMedia.tsx', import.meta.url), 'utf8');
const progressSource = fs.readFileSync(new URL('./inspiration/VideoAnalysisProgressPanel.tsx', import.meta.url), 'utf8');
assert.match(source, /import \{ WatchModal, sourceEmbedUrl \} from '.\/inspiration\/InspirationWatchModal'/);
assert.match(watchModal, /zIndex=\{2200\}/, 'the original-content preview must render above the Ant detail drawer');
assert.match(watchModal, /video\.videoUrl && !useEmbedPlayer/);
assert.match(watchModal, /embedUrl \?/);
assert.match(watchModal, />原站打开</);
assert.doesNotMatch(source, /DiscoveryScopePanel|当前发现范围|导入对标视频并分析|inspiration-creation-account/, '灵感首页不得重复展示范围、创作账号和导入说明卡');
assert.match(source, /<Tabs className="min-w-0 flex-1"[^]*?<AntUpload className="shrink-0 pt-1"[^]*?>导入 MP4 并分析</, '导入动作必须收进 Tabs 右侧工具栏');
assert.match(cardsSource, /apiUrl=\{video\.videoUrl\}[^]*?loadOnMount[^]*?previewFrame[^]*?preload="auto"/, '爆款视频卡必须主动加载首帧，不能依赖悬停');
assert.match(cardsSource, /analysisPaused[^]*?mediaState = !analysisPaused/, '暂停分析不得用状态遮罩盖住现有封面');
assert.match(progressSource, /isInterrupted[^]*?>继续分析</, '暂停或取消后必须提供继续分析入口');
assert.match(source, /import \{ MaterialLibraryCardMedia \} from '.\/MaterialLibraryCardMedia'/);
assert.match(materialMediaSource, /function MaterialCardMedia[\s\S]*?<LsMediaStateFrame[\s\S]*?重新加载/, '素材卡必须使用统一媒体状态并提供失败重试');
assert.match(materialMediaSource, /videoFallback[\s\S]*?<AuthenticatedVideo/, '素材封面不可用时必须主动回退到视频首帧');
assert.match(materialMediaSource, /materialPreviewImageSources[\s\S]*?material\.segments[\s\S]*?material\.url/, '素材封面必须依次尝试主封面、片段封面和图片原文件');
assert.match(materialMediaSource, /MaterialCardMedia[\s\S]*?onRefresh[\s\S]*?await onRefresh\?\.\(\)[\s\S]*?正在刷新/, '素材封面重试必须先刷新短期地址，再重载媒体');
assert.match(mediaSource, /fetch\(src, \{ headers: authHeader\(\), cache: 'no-store'/, '受保护封面重试不得继续命中浏览器中的失败缓存');

console.log('Inspiration preview stacking and fallback contract passed');
