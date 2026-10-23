# 小程序独立开发起点

建立日期：2026-10-23（Asia/Shanghai）。

## 源码与工作位置

- 权威集成检出：`/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`。
- 来源分支：`xixi1021程永罗沟通前大整合`。
- 本次固定起点：`f9cff15fcc4552747697b722ba0d418bdf659e72`。
- 小程序开发分支：`feature/lingshu-miniapp-20261023`。
- 独立开发根目录：`/Users/julia1/Documents/ChatGPT/1023灵枢小程序`。
- 微信开发者工具导入目录：本文件所在的 `apps/shooting-miniapp`。

此检出使用完整仓库，保留服务端接口及共享代码，便于继续复用同一身份、租户、任务与审批契约。创建时来源工作区含其他任务的未提交改动，本检出仅取上述已提交 SHA，不包含这些改动。没有推进集成基线，也没有合并其他功能分支。

## 现有功能代码

原生入口为 `app.json` 与 `pages/workbench/index`。现有分包包括运营、管理和客服；运营分包包含素材、拍摄、原生相机、成片验收、助手、消息和询盘页面。具体实现与运行要求见同目录 `README.md`。本次建立开发分支，没有新增业务功能或修改接口配置。

## 起点验证

在新检出、业务源码零修改状态下执行：

```sh
node --test apps/shooting-miniapp/*.test.cjs
```

结果：101 项，98 项通过，3 项失败，均位于 `workbench-experience.test.cjs`：

- `sign out invalidates pending assistant response and status cleanup`：`resolve is not a function`。
- `read-only assistant query uses server session without client business prompt`：读取未定义对象的 `content`。
- `execution candidate requires server preview then explicit confirmation`：读取空对象的 `previewId`。

这些是固定起点的已有失败，尚未定位原因或修复，不将本起点描述为全绿基线。执行时使用本机 bundled Node；未安装仓库依赖，未运行全仓 TypeScript、构建、架构扫描、迁移清单检查或真实接口联调。尚未在微信开发者工具编译或真机验收；没有登录生产账号、调用付费供应商、执行迁移、推送或部署。

恢复源码时可使用上述固定 SHA 重新建立检出；不要覆盖本目录后续未提交改动。后续功能开发遵守仓库根目录 `AGENTS.md`，共享源修改通过既有生成器同步，不能直接编辑生成产物。

## 后续修复与验证（2026-10-23）

上述 3 项助手测试失败已定位到测试模拟：会话列表路径增加 `?contextMode=operator` 后，旧模拟的 `endsWith('/sessions')` 不再匹配，导致会话恢复失败。模拟改为按查询参数前的路径匹配；准备函数等待页面自己启动的恢复过程，避免额外恢复第二次。助手业务实现和接口均未修改。

本轮新增拍摄前对标片段查看，改动集中在 `lib/shootingList.js`、运营首页与拍摄任务详情，以及对应测试和 README；具体行为见 README 最后一节。源码起点与分支未变，改动尚未提交。

实际通过：

- `node --test apps/shooting-miniapp/*.test.cjs`：113/113。
- `node --test scripts/mobile-shared-package.test.mjs`：3/3。
- `node scripts/sync-mobile-shared.mjs --check`：通过。
- `pnpm run lint`：TypeScript 通过。
- `pnpm run check:architecture`：2,453 个生产 TypeScript 文件通过；另外以 `ARCHITECTURE_BASE_REF=f9cff15fcc4552747697b722ba0d418bdf659e72 node scripts/check-architecture.mjs` 核验 ratchet 通过。
- `git diff --check`：通过。

微信开发者工具已打开本目录，界面与调试器均报 `simulator launch failed`；未进入页面，不能据此声明编译/模拟器或真机验收通过。未运行全仓构建、迁移检查或真实供应商联调，没有推送、发布或部署。

## 模拟器后续恢复与实际播放验收（2026-10-23）

上节是首次尝试的历史结果。本轮已确认基础库缓存校验异常由工具重新下载修复，重新编译可以正常进入页面。连接已有 `8790` 本地测试账号后，发现原待拍任务没有项目与分镜绑定；使用明确标记的只读隔离任务投影，引用同账号原有灌装视频，完成两次实际播放和进入拍摄的验证。

修复本地后端媒体检出路径缺失，补充根据真实媒体进度定时停止片段，减少原生进度回调间隔带来的越界播放。回归 115/115、包完整性 3/3、TypeScript 和架构 ratchet 均通过。临时服务已停止、网络校验已恢复，没有向原账号新增或修改业务记录。完整的日志、采样、媒体链接恢复点与限制见 `docs/runbook/MINIAPP-SIMULATOR-ACCEPTANCE-20261023.md`。
