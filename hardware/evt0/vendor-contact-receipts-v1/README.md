# Vendor Contact Receipt v1

本合同位于确定性外发包与供应商回件之间，只回答一个问题：**某一份已锁定字节的询证文本，是否经当日复核的官方入口完成了人工提交，并留下可复算原始证据。**

```text
vendor-outbound-v1 / PREPARED_NOT_SENT
  -> 人工复核官方入口
  -> 人工发送或提交
  -> vendor-contact-receipts-v1 / AWAITING_RESPONSE
  -> 原始供应商回件
  -> vendor-evidence-v1 / EVIDENCE_REQUIRED 或 READY_TO_BUY
```

## 边界

- `AWAITING_RESPONSE` 只证明归档的渠道、非空传输引用与本地提交回执闭合，不证明对方已阅读、交付成功或答复；
- `targetBindingEffect` 固定为 `NONE_CONTACT_ONLY`；
- `paymentEffect` 固定为 `NONE_AWAIT_VENDOR_RESPONSE`；
- 发送回执不会填充五元组，不会更新 `target-binding.json`，也不会产生采购资格；
- 邮件、网页表单和 FAE 路由均由人员在官方入口完成，本合同不保存账号凭据。

## 建立真实记录

1. 先运行 `npm run refresh:vendor-contact-sources` 与 `npm run validate:vendor-outbound`，再用准备命令建立不可变外发归档和保持
   `PENDING_SEND` 的草稿。例如：

   ```powershell
   npm run prepare:vendor-contact-receipt -- `
     --message-id MB1-OUT-ZTRON-LOCAL `
     --receipt-id 20260804-ZTRON-01
   ```

   `prepare:vendor-contact-receipt` 已串联联系入口刷新和外发包校验；命令会复制完整当前 bundle 到 `build/vendor-contact-receipts/<receipt-id>/outbound/`，创建
   `raw/`、`receipt.draft.json` 和逐步发送清单；它不提交任何外部消息。
2. 对已经准备的全部工作区运行发送前防漂移门：

   ```powershell
   npm run check:vendor-contact-send-readiness
   node scripts/check-vendor-contact-send-readiness.mjs --receipt-id 20260804-ZTRON-01
   ```

   它检查 draft Schema、目录/receipt ID、pending 状态、冻结 manifest/message/recipient 的
   bytes/SHA-256、sourceRef/官方 URL、空 `raw/`、正式 record 空位和当前 outbound tree 一致性，报告输出到
   `build/vendor-contact-send-readiness.json`。检查器只生成本地 preflight 证据。
3. 在发送当日重新打开官方入口，把页面或表单保存到
   `build/vendor-contact-receipts/<receipt-id>/raw/`；
4. 发送后把带 Message-ID 的 `.eml`/已发送邮件导出，或网页确认页 PDF/PNG、FAE 工单号原件保存到同一目录；
5. 复制 `receipt.template.json` 到 `records/<receipt-id>.json`，逐项填写实际值并计算每个原始文件的 bytes/SHA-256；
6. `verificationArtifactRefs` 指向入口复核证据，`submissionArtifactRefs` 指向发送/提交回执；`transportReference` 填实际 Message-ID、表单确认号或 FAE 工单号；
7. 只有校验通过的真实记录才计入 `submittedReceiptCount`。

邮件记录的 `recipientValue` 必须是归档 `recipient-entry.json` 中列出的地址；网页/FAE 路由的
`recipientValue` 使用该归档中的精确官方入口 URL。所有 raw artifact 必须解析到本回执自己的
`build/vendor-contact-receipts/<receipt-id>/raw/`，不可跨回执复用。

发送文本必须引用归档 `bundle-manifest.json` 中对应 message 的 `.email.txt` 字节与 SHA-256。
每份回执使用自己的不可变归档副本，因此外发包后续重建不会让历史回执漂移；新发送动作则绑定当时最新的
`reproducibleId`。

## 校验

```powershell
npm run check:vendor-contact-send-readiness
npm run test:vendor-contact-send-readiness
npm run validate:vendor-contact-receipts
```

校验覆盖 Schema、归档外发 bundle/message/recipient-entry 绑定、sourceRefs 与官方 URL/收件地址交叉绑定、
规范化 receipt-bound 路径、非空传输引用、渠道对应 artifact、发送时间、原始 artifact
实际存在/bytes/SHA-256、唯一 receipt ID、状态单独提升、缺入口/提交证据、消息候选串线和
目标/付款效果边界；隔离自检还会建立完整文件闭包并验证重复 ID 与篡改拒绝。真实记录报告输出到
`build/vendor-contact-receipts-validation.json`，自检临时目录在结束时清理。

发送前 checker 的隔离自检覆盖完整工作区通过、消息篡改拒绝、`raw/` 残留拒绝和正式 record
ID 冲突拒绝；它已并入 `validate:vendor-contact-receipts` 的回归链。
