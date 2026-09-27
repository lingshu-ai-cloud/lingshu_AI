# 美妆试用账号可迁移数据包

本目录保存 `beauty-showcase@local.test` 的可迁移业务数据与账号实际引用的本地媒体，用于在开发环境恢复同一套验收数据。

- 包含 30 条视频记录、27 个对标账号、30 条素材和对应本地媒体。
- 产品目录已替换为《融尚货盘报价表_零售价7.14.pdf》中的 41 款 GUIANFA 商品，价格、规格与卖点按附件录入。
- 附件实际内嵌 40 张独立商品图，均已直接提取；第 38 款“混合奶油喷雾”在 PDF 中没有嵌入产品图，目录保留缺图标记，避免错配或伪造。
- 不包含密码、密码哈希、盐值、会话、Cookie、Token、API Key 或管理员数据。
- TikTok 缓存视频只允许用于参考分析，不代表取得再次发布或商用授权。
- B2B 公开视频片段及 B2C 图片保留原始来源、许可和审核状态；标记为 `reference_only` 的内容不可直接进入商用成片。
- 未纳入 5 个仅用于裁切的原始大体积 WebM 源文件；账号实际使用的是数据包中的 21 个 MP4 片段。

校验数据包：

```bash
pnpm run fixture:beauty:verify
```

恢复到本地开发环境时必须在命令行单独提供新密码，密码不会写入仓库：

```bash
BEAUTY_SHOWCASE_PASSWORD='<至少 10 位的本地密码>' pnpm run fixture:beauty:import
```

重新从当前本地账号导出：

```bash
pnpm run fixture:beauty:export
```
