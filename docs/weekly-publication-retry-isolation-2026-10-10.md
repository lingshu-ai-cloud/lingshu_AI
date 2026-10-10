# 周发布重试与原回执隔离验收

日期：2026-10-10（Asia/Shanghai）。核验本地仓库 `local-integrated-flow`，起始 HEAD `89e66fa`。

独立测试：`server/publishing/weeklyPublicationRetryIsolation.integration.test.ts`。

使用现有正式周质量、人工审批、库存复用和 G6 fixture；媒体 fixture 的临时路径由 fixture 独立分配并在测试结束清理。供应发布和回执查询使用受控 adapter，未向外部平台发送视频。

验收顺序与结果：

1. 原发布已进入供应调用但响应未返回时，8 个并发启动请求均读到原 `in_flight` attempt。
2. 供应作用后模拟响应丢失，原 attempt 保持 `unknown`；8 个并发重复启动请求均返回原 attempt。
3. 第一次原 attempt 查询仍为 unknown，第二次返回受控 published 回执。
4. 完成后的启动和查询均直接返回原终态。
5. 全过程仅 1 次 publish、2 次 reconcile、1 个 durable attempt，所有供应交互绑定同一 attempt ID。

执行与证据：

```sh
tsx --test server/publishing/weeklyPublicationRetryIsolation.integration.test.ts server/publishing/weeklyPublicationReceiptRace.integration.test.ts
```

实际结果：3/3 通过，0 fail、0 skip、0 TODO。联合覆盖原 provider callback 与迟到 unknown 查询竞态、两个查询竞态、响应丢失后的批量重试。

此证据证明受控发布尾链的幂等及回执恢复；不证明实际外部平台发布，也不替代完整创意生产 E2E。
