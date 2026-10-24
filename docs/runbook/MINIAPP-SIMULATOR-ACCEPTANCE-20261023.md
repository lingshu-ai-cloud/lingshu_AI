# 小程序模拟器与对标分镜验收

日期：2026-10-23（Asia/Shanghai）。小程序分支 `feature/lingshu-miniapp-20261023`，源码起点 `f9cff15fcc4552747697b722ba0d418bdf659e72`；本轮改动未提交。微信开发者工具 Stable `2.02.2608080`、基础库 `3.17.4`、iPhone 12/13 (Pro) 模拟器。

## 启动问题证据与恢复

开发者工具日志目录为 `/Users/julia1/Library/Application Support/微信开发者工具/d1e8765721a6c23d43b14c95b1843e6b/WeappLog/logs/`。

- `2026-10-23-13-51-04-716.log`：13:51:07.994 记录 `3.17.4.wxvpkg verify md5 error`；13:51:10.330 记录下载和校验成功。
- `2026-10-23-13-51-08-381.log`：13:51:20.399 记录 `routeTo appLaunch timeout`。
- 主日志中，本任务项目 `rt:1,win:s1` 在 13:51:21 记录 `simulator launch failed`；13:52:29.222 记录 `simulator launch success`。本轮再次点击编译，13:56:26.489 记录同一项目启动成功，界面进入登录页；后续源码重编译也能进入工作台。

缓存异常已由工具自身重新下载修复。日志能确认缓存修复、首次启动失败及重编译成功的顺序，不能断言缓存异常是该窗口失败的唯一原因。本轮没有删除开发者工具缓存、重装工具、改变全局设置或修改其他项目源码。

## 账号与数据条件

原小程序配置指向 `8791`，该服务默认本地预览账号没有待拍任务。已改接 `http://127.0.0.1:8790`：通过其既有 `/auth/local-preview-session` 正常取得测试会话，账号为 `codex-1002-preview-20261004@local.test`，租户为 `local_tenant_customer_1b2913131e2c46deab66172228c4df0a`。会话沿用小程序原有登录存储；没有将密码或 token 写入仓库、命令文本或验收记录。

该后端实际运行 build SHA 为 `af134002399e664921a88bb8c222af0e6a9866e2`；不是本任务的小程序源码基线。`/ready` 返回 `degraded`，问题为 `pocketbase_unavailable_or_unmigrated:fetch failed`，所以本次不能算全系统或供应商就绪验收。

原待拍任务只有一条：`studio_shooting_tasks_c447403dc8364555922e3d6cff6c98e1`，标题“[本地预览] 产品包装近景”，没有来源项目及分镜绑定。实际验证其运营首页、详情空态、进入相机、FB/TK 安全区切换及返回；没有将这条未绑定任务描述为已能播放对标分镜。

为验证播放，使用明确标为“【隔离验收】”的临时任务投影，来自同账号既有项目 `studio_projects_1e3b0dea4f6f451f846880c42867f74a` 的 `slot-15`，对标视频记录 `trend_videos_192e76d4b21244c4a2922e60672c95f2`，真实灌装镜头区间 `23.77–25.30` 秒。临时服务仅监听 `127.0.0.1:8792`，转发只读接口并在内存补齐测试任务；除既有本地会话入口外拒绝所有写请求。实测任务写入请求返回 `isolated_acceptance_read_only`。原账号的任务、项目和视频记录未改。

## 媒体读取修复

最初视频地址签发成功，但实际媒体 Range 请求返回 404 `Video not stored`。原因是运行后端从 `total-merge-langgraph/data/media` 读取文件，而该记录对应的现有视频位于旧测试数据根目录。

保留原文件，在缺失位置建立单文件符号链接，无覆盖操作：

```text
目标：/Users/julia1/Documents/Codex/2026-10-11/new-chat/work/total-merge-langgraph/data/media/tenants/local_tenant_customer_1b2913131e2c46deab66172228c4df0a/reference-videos/trend_videos_192e76d4b21244c4a2922e60672c95f2.mp4
来源：/Users/julia1/.codex/.chatgpt-projects/g-p-6ac46f113a0c8191968cd499b8c020f6/local-preview-1002/data/media/tenants/local_tenant_customer_1b2913131e2c46deab66172228c4df0a/reference-videos/trend_videos_192e76d4b21244c4a2922e60672c95f2.mp4
大小：6412289 字节
SHA-256：501ec2c4d39ce67630448eff7001e2f911561e962533ca1bdb6aa10e6d2388e9
```

修复后原后端和临时验收服务均通过既有签名媒体接口返回 `206 video/mp4`、`Content-Range: bytes 0-1023/6412289`。原鉴权与租户检查保持。此链接保留为本地媒体路径修复；若撤回，仅 unlink 目标符号链接，不能删除来源视频。

## 实际操作与结果

1. 在当前项目临时创建 `project.private.config.json`，设置 `setting.urlCheck=false`；这是用户明确授权的本次联调设置，未改全局配置。
2. 登录既有测试账号，点击运营首页待拍卡片。详情先展示对标播放器和时间区间，随后为拍摄要求；未自动进入相机。
3. 点击播放：实际看到灌装机械臂和瓶体画面，保持完整竖屏构图。
4. 实测发现仅用原生 `timeupdate` 时，第二次播放偶尔到 `25.557` 秒才停止。补充按最新媒体时钟计算剩余时间的结束定时器；暂停、缓冲、离页、切任务和错误均清理定时器，保留进度事件的兜底停止。
5. 重编译后再次进行两次真实播放，通过临时只记录事件的观察器读取以下采样，观察器随后撤除：

```text
第 1 次：23.77, 23.951026, 24.218523, 24.484177, 24.750705,
         25.015890, 25.282626, 25.306227, 23.77, 23.77
第 2 次：23.956757, 24.222404, 24.490172, 24.754701,
         25.018973, 25.286024, 25.306047, 23.77, 23.77
两次结束：playing=false，position=23.77，timerCleared=true。
```

6. 点击同一详情的“打开相机”，实际进入 `packages/operator/camera/index`，显示同一工厂灌装镜头的拍摄要求、比例和声音要求。随后退出相机；未录制、上传或关联素材。本结论仅覆盖模拟器播放和拍摄入口，不代表真机录制验收或逐帧精确裁切。

## 验收工具与收尾

可复用的临时只读适配器为 `scripts/miniapp-benchmark-preview-fixture.mjs`，启动示例：

```sh
MINIAPP_FIXTURE_PROJECT_ID=studio_projects_1e3b0dea4f6f451f846880c42867f74a \
MINIAPP_FIXTURE_SLOT_ID=slot-15 \
node scripts/miniapp-benchmark-preview-fixture.mjs
```

此脚本必须连接已有本地测试服务，不创建业务记录，不能用于生产。结束时已经停止 `8792` 临时服务，将小程序配置恢复为真实本地后端 `8790`，删除本次临时私有配置，确认网络校验重新拦截本地 HTTP 请求。下次本地 HTTP 联调需按当次授权临时配置校验；不能把该拦截误判为模拟器启动失败。

小程序回归 115/115、原生包完整性 3/3（合跑 118/118）通过，新增覆盖媒体时钟定时停止、缓冲/暂停清理及切换任务不误停。实际命令为 `node --test apps/shooting-miniapp/*.test.cjs scripts/mobile-shared-package.test.mjs`、`node node_modules/typescript/bin/tsc --noEmit`、`ARCHITECTURE_BASE_REF=f9cff15fcc4552747697b722ba0d418bdf659e72 node scripts/check-architecture.mjs`、`node --check scripts/miniapp-benchmark-preview-fixture.mjs` 和 `git diff --check`，均通过。包完整性测试也执行共享生成检查。没有生产操作、付费调用、迁移、发布或部署。
