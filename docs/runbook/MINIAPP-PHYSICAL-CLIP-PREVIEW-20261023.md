# 小程序实际裁剪片段预览验收

日期：2026-10-23（Asia/Shanghai）。工作树 `/Users/julia1/Documents/ChatGPT/1023灵枢小程序`，分支 `feature/lingshu-miniapp-20261023`，HEAD `f9cff15fcc4552747697b722ba0d418bdf659e72`。本次源码未提交、未推送、未部署；只使用隔离的本地测试数据及既有测试账号。不是生产或黄金环境验收。

## 行为与实现

对标分镜现在播放独立 MP4 文件，片段内时间从 0 开始，文件只包含该镜头的源帧。原视频时间范围仍作为说明展示。详情页的自然 `ended` 事件负责暂停和复位；实际裁剪片段不会创建停止计时器，也不会在末端退回完整源视频。

- 新增 `POST /api/overseas/studio/shooting-tasks/:id/reference-preview`。作用域取已认证租户，时间和视频身份取任务绑定；拒绝跨租户、失效绑定及与当前分析不一致的区间，客户端不能传任意路径或裁剪时间。
- `server/routes/shootingReferencePreview.ts` 复用现有物理分镜物化服务、持久化证据和签名资产机制。相同分析的并发请求共用本次物化操作，返回前复核任务仍属于当前租户且绑定未变化。
- `server/lib/referenceShotClip.ts` 按解码源 PTS 做半开区间 trim，重设输出 PTS，音轨同步裁剪，重新编码以支持非关键帧起点。六位小数时间标签按半微秒舍入容差处理，切点帧归入下一个镜头。
- `server/lib/referenceExactShotMaterialization.ts` 记录 `source-clock-trim-v2`，核验字节指纹；旧提取版本或损坏文件会重新物化，在既有租约及证据校验下更新派生记录，不覆盖原始分析和任务。
- 小程序详情和列表的对标来源均请求裁剪片段。失败显示重试入口；保留进入拍摄能力。原相机、上传及任务关联业务未改变，既有完整视频 `media-url` 接口未改变。

## 原视频字节验证

原片：`trend_videos_192e76d4b21244c4a2922e60672c95f2`，33.58 秒，SHA256：

`501ec2c4d39ce67630448eff7001e2f911561e962533ca1bdb6aa10e6d2388e9`

17 个分镜全部物化。逐镜分别解码实际 MP4 及相同源时间范围，缩小至 32×32 RGB 后逐帧比较，**1007/1007 帧对应、每段帧数一致**。重新编码存在有损差异，最大单帧平均像素绝对误差为 0.9685/255；不宣称重编码像素完全相等。每个成片文件的 SHA256 与物化证据一致，首帧、末帧均在比对范围内。

实验室环绕为 12.566667–14 秒，43 帧；包装短镜头为 5.1–5.966667 秒，26 帧。自然播放即使稍晚派发结束事件，也只能停留在当前片段的最后画面，没有后续镜头字节可播。

审计目录：`tmp/miniapp-binding-acceptance-20261023/physical-preview/`（本地忽略目录）。

- `verify.mts`、`verification.log`、`original-video-frames.json`：真实任务接口、原视频及 17 片段的帧数、误差和指纹。
- `studio_shooting_tasks_*.json`：本地签名预览响应，仅保存在本机。
- `native-play-events.txt`：模拟器真实播放事件与片段绑定；观察包装器将事件原样转发给原函数，未伪造成功状态。
- `native-product-clip.png`：小程序实际包装片段画面。
- `native-product-camera.txt`：拍摄页真实路由及对应拍摄要求，无需公开相机画面。

## 模拟器完整入口流程

本地后端 8793、网页 5188。使用既有本地测试账号 preview-session 正常登录，在当前工作树项目的原生微信模拟器运行。

任务 `studio_shooting_tasks_bad00de6a4364ff0896cfea9eff5946f`：

1. 按真实任务 ID 进入既有待拍详情，服务返回 `physicalClip:true`、`start:0`，URL 路径属于 `reference-evidence` 下的独立 MP4；保留原片 5.1–5.966667 秒说明。
2. 第一次真实 timeupdate：0.152203、0.418691、0.684753、0.882381，收到 `ended` 一次后复位 0；`playing:false`、`referenceEndTimer:null`。
3. 第二次真实 timeupdate：0.207872、0.472744、0.737841、0.882381，再收到 `ended`，累计 2 次；再次复位 0，停止计时器仍为 null。
4. 页面播放按钮也已实际点击，并保存正确灰盒和银袋画面。
5. 实际点击“打开相机”，进入 `packages/operator/camera/index`，页面显示“拍摄要求 双手举起灰色纸盒和银色袋装产品，近景展示正面包装 0.87 秒 · 9:16 · 可后期配音”。之后返回详情。未录制或上传素材。

0.882381 秒为裁剪文件媒体时钟，包含编码音频包时长；视频只有规定的 26 帧。不能把容器音轨尾部当作源视频相邻镜头越界，视频帧范围已独立逐帧核验。

历史 `studio_shooting_tasks_17dcbb8cbe6540508d5f5567e4b5a64c` 保留旧区间，本次正确返回 409，不静默改写任务或回退播放整片；模拟器控制台中相关 409 属于这条历史任务。无绑定的旧预览任务仍显示空态。

## 检查与恢复

- 服务端定向测试：`node --import tsx --test server/routes/shootingReferencePreview.test.ts server/routes/shootingTasks.test.ts server/lib/referenceExactShotMaterialization.test.ts server/routes/referenceExactShotMaterialization.test.ts`，4/4 通过。
- `node --test apps/shooting-miniapp/*.test.cjs`，118/118 通过；`node --test scripts/mobile-shared-package.test.mjs`，3/3 通过。包含裁剪失败不回退、自然 EOF 复位、重复播放无计时器、任务切换与拍摄入口回归。
- 真实红→蓝→绿带音频测试，在非关键帧边界上裁剪，逐一检查蓝色片段全部 31 帧的全部像素，最后一帧没有邻景；并覆盖租户、过期绑定、并发及旧提取版本更新。
- `node scripts/sync-mobile-shared.mjs --check` 通过。
- `node node_modules/typescript/bin/tsc --noEmit`、`node scripts/check-architecture.mjs`、`git diff --check` 通过。架构跨基线棘轮未运行（未设置 ARCHITECTURE_BASE_REF）。

本次没有调用视觉供应商，没有新增付费请求。开发者工具导入时自动补写的项目配置已恢复，当前项目私有配置 `setting.urlCheck:true`，临时 HTTP 放行已撤回。保留本地服务、隔离 store、原视频与派生证据以供继续检查。真机录制、上传及生产部署未纳入本次入口验收。
