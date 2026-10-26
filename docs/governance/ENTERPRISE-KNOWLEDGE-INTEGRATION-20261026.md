# 企业知识库合入最新统一基线（2026-10-26）

- 用户指定版本名称：`差图文创作加联调`，同名本地分支保留集成结果。
- 起点：`baseline/unified-20261026` / `a0d965ae9af64ef2a6229198b496fa7a168f3374`。用户此前提供的远端 `7cb757c1` 是此基线祖先，不回退。
- 来源：`feature/enterprise-knowledge-20261026` / `969665d7aa4bb37610ed6220d9be3cf4c4a9e000`。
- 合并源码：`ddd146831e25d0ee3fc269fe63b2140c9ed43a3f`；79 个文件，1764 行增加、266 行删除。只有两处冲突：UI 规范保留双方新增规则；任务简报解析合并产品素材选择和 illustrativeSceneIds 的验证导入。不改写既有首页和图文调度。
- 未新增依赖、迁移、预算豁免或平行业务主流程。企业信息、产品身份及素材选择继续使用现有租户隔离、版本化资料、素材库、项目与任务接口。详细功能范围见 `docs/qa/product-material-selection-2026-10-26.md`。

## 实际检查

- 变更测试文件组合：`node --import tsx --test --test-concurrency=1`，66/66，无跳过。
- `pnpm run test:image-replication`：24/24；`pnpm run test:content-production-v4`：75/75。
- `pnpm run test:assistant-quality`：150/151。失败为 assistantHomeQuickPrompts 的 CO-SPEECH-HIGHLIGHT/CO-13 顺序断言；在原 a0d965ae 工作树运行同一测试复现，生产文件与测试均非本轮变更，作为既有失败保留。
- `pnpm run lint` 通过；`ARCHITECTURE_BASE_REF=a0d965ae pnpm run check:architecture` 通过（2982 个生产 TS 文件，含棘轮）。
- `pnpm run check:digital-employee-migrations` 通过（204 项，只读），`pnpm run test:migration-guard` 通过；没有执行目标库迁移。
- `pnpm run build` 与 `pnpm run build:account-hub` 通过，Studio 373288/485000 bytes；保留既有大分包警告。
- `git diff --check a0d965ae HEAD` 通过。

- `pnpm run quality` 首轮在 four-platform-release 因脚本默认 PB_BIN 路径不存在中断；指定现有 `/Users/julia1/.local/share/lingshu/pocketbase/pocketbase` 后从该阶段续跑，通过外部视频审批隔离测试、共享合同和本地生产运行门禁（真实本地媒体测试1/1）。随后 weekly-golden-journey 的既有 M1 用例因 `controlled M1 forbids external network: api.heygen.com` 失败；此问题已由原基线治理记录列明，未绕过受控网络门禁。M1 断言失败后测试进程仍驻留，本轮仅终止该隔离测试的子进程树；后续 quality 阶段未执行，未运行 verify。不是单次 quality 全绿。

## 安全恢复与边界

- 权威工作树原有 `server/videos/videoVisibilityMaintenance.ts` 未提交改动不纳入提交。原始完整 diff SHA-256：`ed50ec18853d813c6307d1c7dd9ff1c7d020ec37735282d44ea368ff334a289b`。
- 起点 a0d965ae、来源969665d7及隔离集成树保留。证据：`/Users/julia1/.codex/integration-evidence/20261026-enterprise-baseline/`；未迁入本地数据、素材或凭据，未触碰图片 AIGC 保留树。
- 本轮没有推送、部署、真实供应商调用或发布；未创建外部 run/task。源码整合不代表供应商 Ready 或发布就绪。原预览进程未自动切换版本。
