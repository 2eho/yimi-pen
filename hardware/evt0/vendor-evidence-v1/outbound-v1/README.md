# MB1 Outbound Bundle v1

本目录把 `HW-MB1-PREPAY-01` 变成可复算、可交给采购人员手动执行的外发包。
它只准备邮件文本、官方入口、附件请求和回件归档路径；**不发送邮件，不提交网页表单，
不记录供应商回复，也不推进付款、采购或 `BOARD_TARGET`。**

## 内容与边界

| 模板 | 作用 | 收件入口 | 回件用途 |
|---|---|---|---|
| `messages/ref-ztron-local.template.json` | 完整 PCBA/OID 候选一 | Ztron 官方联系入口 | 进入 `vendor-evidence-v1` 的独立 candidate response |
| `messages/ref-chunmiao-local.template.json` | 完整 PCBA/OID 候选二 | Chunmiao 官方页面/其后续官方入口 | 进入 `vendor-evidence-v1` 的独立 candidate response |
| `messages/sonix-oid-component.template.json` | 原厂 OID 组件交叉核对 | Sonix 官方 FAE 入口 | 原始文件归档；不替代完整 PCBA 付款门 |

每个模板固定 `PREPARED_NOT_SENT`。PCBA 模板都要求 `M01–M08` 和 `A01–A10`；
原厂交叉核对只请求组件身份、组合、资料和 FAE/伙伴路径，绝不作为完整板卡候选。

## 构建与检查

在仓库根目录执行：

```powershell
node scripts/build-vendor-outbound.mjs
node scripts/build-vendor-outbound.mjs --check
```

构建结果位于被 Git 忽略的 `build/vendor-outbound-v1/`，包含：

- 每个模板的 `.email.txt`：主题、正文和人工收件入口说明；
- 每个模板的 `.attachment-request-checklist.md`；
- 每个模板的 `.recipient-entry.json`；
- `reference/`：可随邮件附送的 MB1 预询证与详细 RFQ 来源副本；
- `bundle-manifest.json`：所有输入文件的路径、字节数、SHA-256、生成文件哈希和整体
  `reproducibleId`。

构建器不访问网络、不使用当前时间，也不写任何发送/回复回执。`--check` 只比较磁盘结果
与从当前输入重建的确定性字节；缺失、陈旧或篡改的构建文件会以非零状态退出。

## 采购人员的手动动作

1. 运行构建器并核对 `bundle-manifest.json` 的 `bundleStatus=PREPARED_NOT_SENT`。
2. 打开对应 `.recipient-entry.json`，从其中的官方入口重新核验收件方式，再由人工选择收件人。
3. 复制 `.email.txt` 的主题和正文；按需要附上 `reference/` 中的资料。附件请求清单是请
   对方回传的文件，不是本方已经收到的附件。
4. 发送后，把原始邮件、PDF、图片和压缩包先保存到模板写明的
   `build/vendor-evidence/<candidate>/<received-at>/raw/`，计算字节数与 SHA-256。
5. 从 `hardware/evt0/vendor-evidence-v1/candidate.template.json` 新建该候选的独立回件记录，
   填写真实回件后运行 `npm run validate:vendor-evidence`。

即使完整回件达到 `READY_TO_BUY`，其 `targetBindingEffect` 也仍是
`NONE_VENDOR_CLAIM_ONLY`；两套同版实物通过 `intake-v1` 前，`BOARD_TARGET` 保持
`UNRESOLVED`。

## 输入约束

- `manifest.template.json` 和每个 message template 受 `schema.json` 与构建器的额外语义门约束。
- `sourceRefs` 必须存在于 `hardware/evt0/evidence-sources.json`。
- 生成 ID 包含外发模板、引用源文件及构建器自身的 SHA-256；任一输入字节变化都会改变 ID。
- 模板中的邮箱/表单仅是待人工复核的官方入口线索，构建过程从不连接或投递。