# Meta 人群与版位配置验收记录

2026-10-25，工作树 `/Users/julia1/Documents/ChatGPT/1025投流`，分支 `feature/platform-ads-20261025`，HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`。改动尚未提交；原会话脏改动保留，没有推进集成基线。

## 改动与边界

- `shared/metaTargeting.ts` 定义结构化配置、严格校验、Graph 参数转换与读回比对；`src/lib/platformAdsDomain.ts` 扩展原配置 JSON，无新存储或迁移。
- `MetaTargetingFields.tsx` 替换原无效策略备注，使用 Ant 组件选择年龄、性别、语言、兴趣、自定义受众及自动/手动版位；`PlatformAdsPage.tsx` 接入保存、AI 创编、复开、预览和下一步校验。`platformAds.css` 只复用共享布局和颜色变量。
- `metaTargetingOptions.ts` 与原 `platformAdCreatives` 路由增加经过现有租户/角色/账户授权的只读查询，支持分页游标，不暴露分页 URL 中的令牌。兴趣/语言用官方 search；受众来自账户 customaudiences。失败不假装为空列表。
- `tasks.ts` 保存并校验结构；`preflight.ts`、`execution.ts` 取已保存版本的定向，临时 execute 参数不能覆盖。`metaAdapter.ts` 发送真实 targeting；原创建快照冻结配置。`metaPlanReadback.ts`、`metaPlanAudit.ts`、`shared/metaPlanAudit.ts`、`MetaPlanAuditPanel.tsx` 读回验证并展示原字段。漂移保持 UNKNOWN，之后对账仍依据原创建快照。
- 老草稿未配置时保留旧执行语义；历史备注不转换为平台定向。年龄当前限制 18–65+；不宣称完整复制平台所有人群功能。手动视频位置目前仅 FB/IG 动态、快拍、Reels；是规则目录，不是实时账户兼容性结果。Messenger、Audience Network、Threads、WhatsApp 等位置未接入；自动模式只在所选 FB/IG 渠道内选择，不冒称全平台 Advantage+。

## 实际验证

- `node scripts/test-platform-ads.mjs`：66 个测试文件通过，日志 `tmp/ads-preview/targeting-domain.log`。随后增加执行覆盖、快照漂移对账和前端复开用例，并完成下列最终定向检查；不将前一轮领域全量描述为最终修改后又全量执行。
- `node --import tsx --test server/platformAds/metaTargeting.test.ts src/components/AdPlanWorkspace.test.tsx server/platformAds/execution.test.ts`：最终 15/15 通过，日志 `targeting-final-targeted.log`。覆盖实际适配器请求体、字段丢失/变化、保存与复开、非法参数、旧草稿、分页凭证脱敏，以及客户端覆盖失败、平台漂移 UNKNOWN、修改草稿后按原快照只读对账。
- 最终 `pnpm run lint` 退出 0；`ARCHITECTURE_BASE_REF=dfc9b0c8af85175485cf39370eed92c4be3daedd pnpm run check:architecture` 通过，2766 个生产 TS；`pnpm run build` 退出 0，Studio 367202/485000 字节，原有大 chunk 提示仍存在；`git diff --check` 通过。未跑全仓 quality/verify。
- 原本地授权账户的真实只读查询：Meta v26.0，locale `English` 返回 2 项（English US/UK），interest `Manufacturing` 返回 12 项（原平台名称如实展示），账户自定义受众 0 项；均 HTTP 200。没有将兴趣语义搜索结果重新编造为所搜词。
- 前端单独测试页实际检验账户关联、语言查询与选择、年龄编辑、兴趣查询、自定义受众空结果、手动 FB 动态和 IG Reels 选择。没有提交测试广告计划；原用户页重新打开创编窗口。截图 `tmp/ads-preview/meta-targeting-live-options-20261025.jpg` 展示新控件与真实语言下拉。

## 运行与未完成的真实验收

前端 5237、后端 9037、原 PocketBase 8991；后端 web 角色，没有后台 worker。后端会话日志 `targeting-backend-final.log`，PID 文件 `backend.pid`。继续保留 loopback 与 Meta Graph HTTPS GET 网络限制，未放开真实 POST。未迁移、部署、扩充 OAuth、创建或启用平台广告；无新增外部 run/task 标识。上述不是供应商创建 E2E 或发布就绪证据。

真实平台写入及所有目标/素材/版位组合兼容性尚未验收；须按稳定基线、预算和平台授权要求另行执行，不能从模拟创建测试推导账户全部可用。用户业务参数由用户亲自填写，不以测试配置代填。

恢复点为当前 HEAD 与原位未提交工作区，原运行数据库不变。代码回退须仅针对本次列明文件中的定向增量，不覆盖其他投流改动；没有执行 reset、stash、清理或推送。
