# 六类真实运行证据验收记录

本记录用于人工复核已有只读证据。dry run 报告不产生真实运行验真或发送授权；未完成可信来源复核的项目保持未验真。

## 采集范围

- 采集时间和受信来源：待填
- 当前租户及周包范围已独立确认：待填布尔结论
- 账号 authority revision 与 graph 版本核对：待填布尔结论
- 受限原始证据审计位置：待填受控引用，不填写 token、recipient 或完整原始回执
- 网络调用与外发：本地 collector 为 0

## 分类验收

| 类别 | 本地合同检查 | 可信来源核对 | 租户账号版本绑定 | 有效期核对 | 真实验收结论 | 阻塞代码 |
| --- | --- | --- | --- | --- | --- | --- |
| tenant scope | 待填 | 未完成 | 待填 | 待填 | 未验真 | 待填 |
| weekly package graph | 待填 | 未完成 | 待填 | 待填 | 未验真 | 待填 |
| WhatsApp recipient | 待填 | 未完成 | 待填 | 待填 | 未验真 | 待填 |
| Messenger page recipient | 待填 | 未完成 | 待填 | 待填 | 未验真 | 待填 |
| Instagram professional account recipient | 待填 | 未完成 | 待填 | 待填 | 未验真 | 待填 |
| publication token capability receipt | 待填 | 未完成 | 待填 | 待填 | 未验真 | 待填 |

## 验收与复核

- 验收人和复核时间：待填
- 跨租户、账号身份或版本漂移检查：待填
- 原始来源签名或受信采集记录核对：待填
- 失败条件及需要重新采集的范围：待填
- token 或 capability 过期后的重采要求：待填
- 真实运行前仍需重新检查的授权：待填

采集签名、hash 和历史回执不代替 live 运行入口的权限核验。不得复制 dry run 结果到正式 capability、发布或客户送达证据存储。
