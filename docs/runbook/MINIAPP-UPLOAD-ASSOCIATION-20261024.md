# 小程序上传关联与网页读回验证

日期：2026-10-24（Asia/Shanghai）。工作树 `/Users/julia1/Documents/ChatGPT/1024小程序联调`，分支 `feature/miniapp-integration-20261024`，起点 `89b175109149d4551aeb3ce590fe9c42c46bf23c`，本记录随上传关联修复一同提交；源码基线未推进。开工时已有小程序界面及配置未提交改动，原样保留，不视为本轮修复。

## 修复

素材上传返回 `pb-<recordId>`，元数据保存在当前数据权限绑定的素材存储；待拍关联原先只查旧 `data/materials.json`，因此拒绝刚上传的本企业视频。关联现在复用 `getOwnedCloudMaterialRecord` 查询新素材的归属，保留视频与非参考素材限制；旧 ID 继续查原目录，并拒绝共享素材。未创建素材镜像或放宽跨企业权限。存储异常沿用关联接口的 503，不假报完成。

改动：`server/studio/shootingMaterialOwnership.ts`、`server/routes/studioWorkspaceAdmissionRoutes.ts`；回归覆盖新上传 ID、真实本地元数据存储、跨企业、旧素材、共享/参考/图片拒绝与存储故障。

## 本地实际验证

- Web `127.0.0.1:5191` 与后端 `127.0.0.1:8896`，相同本地账号 `codex-1002-preview-20261004@local.test`，租户 `local_tenant_customer_1b2913131e2c46deab66172228c4df0a`；独立运行数据，web role，不启动生产 worker。
- 用正常项目/社媒任务保存接口准备独立草稿及 `shooting_plan`，实际点击网页“创建待拍任务”。成功任务 `studio_shooting_tasks_4a9f99f63f894ab585de3666f863c10e`，绑定项目 `studio_projects_5b5682d3748a4b86ae69bde750a4a009`、`video-1`、`slot-8`、镜头 `replication-a02f4572715be742cb42b955`。
- 对标视频 `trend_videos_192e76d4b21244c4a2922e60672c95f2`，当前分析区间 **12.53–14.00 秒**。源视频 SHA-256 `501ec2c4d39ce67630448eff7001e2f911561e962533ca1bdb6aa10e6d2388e9`。将既有本地源文件复制到本工作树缺失的 media 路径，未修改其他工作树源文件。
- 预览接口返回物理裁剪片段，播放器区间 0–1.47 秒；Range 读取 **206 / video/mp4 / 1024 字节**。微信模拟器真实显示实验室画面及分镜要求。
- 用 1 秒蓝色测试视频（2301 字节，非正式拍摄成品），经模拟器真实 `wx` 文件系统，调用未修改的拍摄详情 `submit` → `uploadVideo` → `attach`。界面显示“已完成拍摄任务”“已保存并关联任务”。素材 ID `pb-materials_dd46db15a6d74bafb16444e35267fd4f`，复用上轮同内容上传的去重记录。
- 直接后端与网页代理读回的同一任务逐字段一致，`uploadedMaterialIds` 包含上述 ID，正常素材库也可读到同一素材。网页刷新后该卡片出现“返回分镜”入口。
- 原任务 `studio_shooting_tasks_c447403dc8364555922e3d6cff6c98e1` 保持不变。验证时旧草稿分析时间与当前记录不同，首个测试任务 `studio_shooting_tasks_04a53e60373841fa842e9936833a7861` 被正确拒绝预览（409）；其与早先测试任务均保留，不冒充成功任务。最终任务使用对齐当前分析版本的新草稿，无修改服务端校验。

## 验证与限制

实际通过：32 项定向测试（含素材本地权限、关联路由、预览路由、小程序拍摄/相机处理）、`tsc --noEmit`、以 `89b17510` 为基准架构/ratchet、`git diff --check`。没有运行全仓 quality/verify，也没有执行迁移。

临时模拟器导航/测试素材入口已移除，`app.js` 恢复原字节；会话凭证未写入源码或文档。证据在忽略目录 `tmp/miniapp-preview/bound-task-check/`：`result.json`、`preview.json`、`media-range.json`、`native-upload-complete.png`、`web-readback.png` 与回归日志。没有实拍摄像头或真机验证，也没有付费生成、外部上传、发布、推送或部署；这里只验证本地模拟器预览与上传关联，不声明拍摄质量或生产就绪。
