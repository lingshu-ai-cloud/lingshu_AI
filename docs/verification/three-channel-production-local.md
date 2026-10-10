# 三渠道生产形态本地验收

本轮使用受控发送端口与内存持久记录，无真实外发。

## 修复

渠道就绪现在按选定账号独立核验 tokenExpiresAt/expiresAt。租户中另一个有效账号不能替代当前任务指定的过期或非法日期账号。已经写入的成功证据在账号过期后也不能继续通过验证。

## 证据

- `socialWeeklyCustomerChannelAdapter.test.ts`：6/6，包含 Messenger/Instagram 指定账号过期、非法日期、成功后过期的回归。
- `weeklyNativeProductionLocal.integration.test.ts`：8/8，两个渠道分别验证账号断连/收件人漂移零发送，provider 接受后 ledger 保存失败仍保留 fencing，item/task/batch 投影恢复，历史写回显式恢复一次且不重发。
- `weeklyWhatsappProductionLocal.integration.test.ts`：1/1，同一混合批次使用真实 WA worker 和原生 durable ledger。WA 保存受控 wamid，原生 timeout 保留 unknown；重复扫描两渠道 transport 各一次。
- 三文件联合执行 15/15；既有 ledger、native scheduled、scan、WA worker 联合基线 26/26。

混合批次新增测试的原生发送直接验证 durable ledger；冻结周任务授权由 native scheduled service 和新增原生整链测试验证。上述证据不表示真实平台授权或部署已经完成。
