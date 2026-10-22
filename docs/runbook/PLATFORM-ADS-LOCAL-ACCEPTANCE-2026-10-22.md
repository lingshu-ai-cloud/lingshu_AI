# Meta 本地暂停创建验收记录

时间：2026-10-22，Asia/Shanghai。功能分支：`feature/platform-ads-meta-workspace-20261022`。

## 隔离运行环境

- 前端 `127.0.0.1:5187`，后端 `127.0.0.1:8890`，独立 PocketBase `127.0.0.1:8891`。
- 全部仓库迁移只应用于新建的 `tmp/platform-ads-live/pb_data`，没有操作基线或生产数据库。
- 广告 16 个集合只读结构检查通过；共享任务锁唯一索引存在，实际获取、续租及释放通过。
- `PLATFORM_ADS_RELEASE_MODE=paused_only`，自动投放关闭，JSON 回退关闭。
- 用户已明确授权五项权限重新签发、真实创建和读回；测试广告必须暂停。令牌经产品账户连接接口加密保存。应用 OAuth 回调配置未设置，本次采用产品已有的令牌连接方式。

## 真实平台证据

- 应用：`2204714410308727`（Lingshu Ads Integration）。
- 真实账户：`1306761139191078`，CNY，Asia/Shanghai，平台账户状态 1。
- 五项权限均返回 granted：ads_read、ads_management、pages_show_list、pages_read_engagement、pages_manage_ads。
- 主页：`1323567870837055`（Ads Integration Test Lab），返回 ADVERTISE 等任务权限。
- 原创六秒测试视频通过产品成片绑定、上传和状态核对：`1838938007302283`，平台返回 ready；SHA-256 `558a360f67bd67577f88ab10996c24edfb8a48daf982e618efe7bf9e7c8a96ac`。
- 账户返回最低系列花费限额 50000 分（CNY 500.00）、最低日预算 672 分（CNY 6.72）。测试采用系列限额 CNY 500、日预算 CNY 50。
- 网站访问计划：`y951p1yaw2mxipp`。首次 CNY 100 预算被平台拒绝，无资源产生；更正后复用了同一平台视频，没有重新上传。
- 创建回执：`qwbe9zv1b7bic0l`，请求 `meta_live_traffic_create_20261022_retry2`。
- Campaign：`120254941289710440`，读回 status/effective_status 均 PAUSED，OUTCOME_TRAFFIC，spend_cap 50000 分。
- Ad Set：`120254941289950440`，读回 status/effective_status 均 PAUSED，LINK_CLICKS、IMPRESSIONS、WEBSITE，daily_budget 5000 分。
- Creative：`1420014263002517`，读回主页、视频、LEARN_MORE 和落地页关联与提交一致。
- Ad 创建被 Meta 拒绝：错误 100 / 1359188，要求账户添加有效支付方式。没有 Ad ID，回执保留 UNKNOWN（部分资源已创建），不可声称完整创建成功。
- 账户结构同步读回：Campaign 1、Ad Set 1、Ad 0。
- 备用沙盒账户 `1640686001100669` 不接受上述普通用户令牌（权限错误 200）；Meta 界面提供专用长期沙盒令牌生成入口，该入口尚未执行。新增长期访问需要用户单独确认。

## 本次修正

- OAuth 补齐主页列表、读取及广告管理权限。
- Meta 错误保留脱敏后的字段/权限说明，去除访问令牌和 URL。
- 创建前读取平台账户最低预算，低于平台限制时在创建任何资源前阻断。
- 明确失败且没有已接受资源的执行允许修正草稿；同一账户、同一素材及有效上传回执可重新绑定新计划版本并保留平台视频。
- UNKNOWN、执行中或已接受结果继续禁止换绑和盲目重建。
- 投流演示数据改为开发环境显式设置 `VITE_PLATFORM_ADS_DEMO_MODE=true`，真实本地联调不混入模拟花费。
- 列表显示已核验暂停、已核验启用、平台结果待核对等实际计划状态。

## 本地操作

`scripts/setup-platform-ads-local.mjs` 只创建忽略目录中的本地凭据及运行配置，需显式指定已安装的 `PLATFORM_ADS_PB_BINARY`。默认端口固定为上述隔离端口。

`scripts/run-platform-ads-meta-live.ts` 是显式操作脚本，会发起真实平台调用。只允许隔离数据库和 paused_only 模式；分阶段保存到 `tmp/platform-ads-live/run.json`，不得把运行文件、令牌或数据库提交到 Git。不要在已有 UNKNOWN 回执时新建请求或重复创建。

当前未完成：Ad 创建、完整四层关联核验、ThruPlay 目标完整创建、完整真实端到端验收。下一步需解决支付方式前置条件，或经确认获取现有沙盒的专用长期令牌后，在沙盒重新验收；保留现有暂停资源作为真实账户证据。

## 代码验证

- `pnpm run test:platform-ads`：37 个测试文件通过（隔离平台模拟，不是真实平台验收）。
- `node scripts/test-platform-ads-ui.mjs`：通过，全部 API 模拟。
- `pnpm exec tsx server/platformAds/currencyExecution.test.ts`、`pnpm exec tsx server/platformAds/creatives.test.ts`：预算最小值和失败后素材复用新增回归通过。
- `pnpm run lint`（TypeScript）、`pnpm run check:architecture`、`pnpm run build`、`git diff --check`：通过。
- 没有执行生产部署、生产迁移、分支合并或推送。
