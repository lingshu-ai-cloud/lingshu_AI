# 交付链路 internal 上线准备与无外发验收

本轮范围是“定目标 → 跑任务 → 看现场 → 领取业务结果”。候选基于此前 internal 已发布版本 `b5b103197f1b9283a089d17f2c9a07f31fb8c20c`，工作区为 `lingshu-delivery-readiness-20260905`，分支为 `codex/internal-delivery-readiness-20260905`。本轮没有推送、部署、发布视频或向客户发送消息。

## 产品行为

- 执行中心按具体交付对象展示：每个内容订单对应独立制作项目，每条客服草稿对应客户、批次、条目和版本。
- 卡片包含实际生产阶段、待处理原因、最后更新时间、产物预览，以及对应业务页面入口。缺文件、缺下载资格、失效审批都不会被视为已交付。
- 成片支持直接预览及下载；草稿展示已审核的实际文本。成片完成与发布、草稿批准与发送分开，外部效果只认渠道回执。
- 进入生产页面保留运行、任务和交付对象，返回时恢复原卡片。公开行业素材明确作为示意，不作为企业工厂、产品性能或所有权证明。
- 自动生产项目有查看保护：工作台自动保存不能覆盖后台的制作证据、订单归属和质检结果；旧客户端写入也由服务端拒绝。修改走任务纠偏，或复制为独立草稿。

## 此次验收实际发现并修复

1. 执行阶段已推进，但残留 queued 标志使卡片仍显示待开始。
2. 进入成片项目时旧工作流上下文或项目选择弹窗遮挡精确目标。
3. 工作台定时保存把自动生产项目的 automation、订单及证据覆盖掉。
4. 自动渲染产生了 MP4，却未登记受保护的渲染任务，下载接口返回 409。现在渲染前登记任务，完整质检后记录完成、文件哈希和字节数；卡片遵守同一下载门槛。旧结果需真实重渲染，不补造完成记录。
5. StrictMode 重复加载提前消费返回上下文，导致返回经营总览。现在保留待恢复上下文，等待有效响应并验证运行/任务归属后恢复原卡片。
6. 配乐制作指令中的时长误判为产品参数；仅允许制作时间表达，产品规格和口播功效仍严格检查。

## 验收证据

证据目录：`data/release-verification/2026-09-05/`。私有验收账号和数据库管理员凭证仅在临时隔离目录保存，不进入本交付包。

| 验收项 | 结果与证据 |
| --- | --- |
| 全部测试 | `npm test` 退出 0，见 full-tests.log |
| 类型 / 构建 | `npm run lint` 等价的 tsc --noEmit 与本地生产构建通过，见 types.log、build.log |
| 卡片、下载资格、导航、自动保存保护 | 专项回归通过，见 delivery.log；服务端 HTTP 验证旧客户端不能覆盖自动项目，普通草稿可正常保存 |
| 两条真实成片 | product.mp4、material.mp4；不是静帧伪装视频，使用真实配音、字幕及公开许可素材 |
| 实际播放接口 | 两条成片均返回 HTTP 206、video/mp4、1024 字节范围数据，见 http-results.json |
| 渲染完成凭据 | render-receipts.json 记录项目、文件 SHA-256、字节数和实际质检结果 |
| 浏览器跳转 / 返回 | protected-project.png、return-to-card.png：精确项目与自动恢复原卡片 |
| 浏览器停留保护 | browser-integrity.json：进入项目并停留超过自动保存周期后，服务端完整项目数据未变 |
| 草稿业务页 | customer-draft.png：对应客户、同一版本批次草稿，通道未连接时没有发送 |
| 无外发预检 | resumed-preflight.json：ready=false；无授权通道，不生成真实发送回执 |
| 真实业务复盘 | resumed-overview.json 保留运行、任务、草稿、复盘及交付资源 |
| PocketBase 0.39.5 迁移 | pocketbase-rehearsal.json/log：全新、基线升级、setup-first 升级均通过，含真实 PB 身份认证、目标审批和任务持久化 |

浏览器专项在独立开发态存储验证。随后另建独立 PocketBase 0.39.5，关闭本地认证/存储回退，以真实 PB 用户从注册开始重跑完整业务流程，**脚本退出 0，验收报告 passed**。直接只读检查 SQLite，确认 1 个运行、11 个任务、2 个项目均持久化，两条成片均为 20 秒、quality.passed=true、ready_for_approval；已审批草稿 1 条、复盘 1 份，真实发布及发送回执均为 0。本地回退文件为 0。

最终真实数据库证据位于 `real-pocketbase/`：`acceptance.json`、`database-evidence.json`、`smoke.log`、`overview.json`。最终成片为 `1-product.mp4` 和 `2-material.mp4`，已经抽帧检查画面与字幕。脚本还逐条请求受保护媒体接口，验证 HTTP 206、video/mp4 及实际范围字节。两个验收环境进程均已停止，数据与证据只保留在本机。

这次完整流程使用全新隔离数据库，仍不冒充当前 internal 服务器的备份或现场验收。

## 素材

许可清单为 `docs/acceptance-materials-2026-09-04.json`。使用 [Pexels 电路板素材](https://www.pexels.com/video/close-up-shot-of-a-printed-circuit-board-6754819/) 与 [工业自动化素材](https://www.pexels.com/video/automated-industrial-manufacturing-process-34775736/)，来源及许可于本轮再次核对，参见 [Pexels License](https://www.pexels.com/license/)。原素材分别约 32.28 秒与 41.24 秒，成片按实际配音长度渲染，不截断口播、不用尾帧填充素材缺口。仅用于有明确行业示意标识的验收产品。

## 上线范围与剩余发布门槛

这些证据证明候选代码的隔离验收，不代表候选已在 internal 上部署。迁移演练重建的是仓库基线，不是当前目标数据库备份。正式选择发布时，仍须核对目标版本、备份及恢复方案，并通过已有运维控制台的发布授权和发布后检查；本轮不触发这些操作。

外部发布、客户真实发送、平台曝光、询盘归因与成交不在本轮无外发范围内，未执行，不记为通过。现场展示任务状态、步骤、持久化产物和真实业务页面；没有 Worker 画面上报时不伪造录屏或鼠标操作。

## 无回退完整验收的复跑方式

先在独立临时目录启动 PocketBase 0.39.5，使用候选的迁移与 setup-pb.ts 初始化；API 与 smoke 脚本必须指向同一个本地 PB，并使用同一组临时管理员凭证。API 禁用发布、跟进发送和数字员工定时 worker，不加载外发凭证。

```sh
DISABLE_LOCAL_AUTH_FALLBACK=true \
DIGITAL_EMPLOYEE_E2E_REAL_PB=true \
DIGITAL_EMPLOYEE_E2E_KEEP_TENANT=true \
DIGITAL_EMPLOYEE_E2E_BASE_URL=http://127.0.0.1:8791/api/overseas \
DIGITAL_EMPLOYEE_E2E_LICENSED_MANIFEST=/absolute/path/materials.json \
DIGITAL_EMPLOYEE_E2E_PREVIEW_DIR=/absolute/path/isolated-artifacts \
npx tsx scripts/smoke-digital-employee-non-meta.ts
```

PB_URL、PB_ADMIN_EMAIL、PB_ADMIN_PASSWORD 通过临时环境注入，不写入仓库。脚本校验本地地址、真实 PB 模式与回退关闭；输出保留以便审计。此模式保留整个一次性数据库，核验后停止进程并按临时目录处理，不能使用仅清理本地 JSON 的旧清理方式冒充数据库清理。


候选代码与最终产物的绝对位置：`/Users/julia_chen/Documents/ChatGPT/lingshu-delivery-readiness-20260905`。当前原型工作区保留原有未提交改动，不作为此次可发布基线。
