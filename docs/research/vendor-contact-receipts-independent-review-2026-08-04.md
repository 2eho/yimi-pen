# Vendor Contact Receipt v1 独立审计（2026-08-04）

## Sol 集成复核（同日）

本报告以下正文保留独立审计时点的原始判定。Sol 随后按发现完成了新合同的结构加固：

- 归档 `recipient-entry.json` 进入 bytes/SHA-256 闭包；`sourceRefs` 精确匹配消息，官方 URL 受 O 级来源与 recipient entry 双重绑定，邮件地址必须在官方条目列表中；
- manifest/message/recipient/raw 使用规范化后的 receipt 独占路径，跨回执 `..` 被负向向量拒绝；
- `receiptId` 字符集、记录文件名、全局唯一性和未来时间进入校验；
- `SUBMITTED` 要求非空 Message-ID/确认号/FAE 工单号及与渠道匹配的原始 artifact；
- 当前聚合结果为 16/16，隔离自检 3/3。
- source ledger 把 Sonix 不稳定 `Last-Modified` 降为响应观察后，当前外发包重算为 `sha256:3ef0820cdc323d0a1cf8dfb80ea918a6c707924025f95c78f17998d19f777d7d`；下文的 `c8f986…` 保留为独立审计时点快照。

因此 R2、R3、R4 已结构性关闭；R1 的本地归档强度已提升，但供应商阅读、最终投递和回复仍由后续原始回件证明。真实 receipt 与 submitted 仍均为 0，当前外部动作继续保持 PENDING。

## 结论

**总判定：FAIL（按“真实证明已提交”且“每份回执绑定自身历史归档”的强验收口径）。**

本实现的本地完整性合同和边界合同通过：它能证明一组由操作人员提供的文件在本地存在、字节数与 SHA-256 一致，并且与一个结构有效的归档外发 Manifest/邮件文本相匹配。当前不存在真实回执记录，因而不存在可宣称的供应商提交事实。

| 审计问题 | 结论 | 依据 |
|---|---|---|
| 当前是否有实际“已提交”事实 | **PENDING** | 校验报告 `receiptRecordCount=0`、`submittedReceiptCount=0`。 |
| 本地文件闭环、篡改检测 | PASS | 归档 Manifest、归档邮件、每个 raw artifact 均校验 bytes/SHA-256；隔离自检包含完整闭环与篡改拒绝。 |
| “真实提交”的独立证明 | FAIL | 提交证据只要求任意本地 artifact 存在且哈希匹配；未约束其语义、发送方、接收方或传输服务端确认。 |
| `BOARD_TARGET` / 付款门（本合同范围） | PASS | `targetBindingEffect` / `paymentEffect` 为 schema 常量，且计入 submitted 仅接受这两个值。 |
| `BOARD_TARGET` / 付款门（全仓库不变量） | PENDING | 本实现没有读取或断言 target-binding、BOM、采购状态等外部文件是否发生同步变更。 |
| 当前 bundle 漂移不影响按正常流程创建的历史副本 | PASS | 准备程序复制 outbound 到 receipt 专属目录；实际记录从该归档 Manifest 校验，不使用当前 bundle。 |
| 回执必须绑定自身归档目录 | FAIL | Manifest/raw artifact 路径未做规范化后目录边界校验，可跨 receipt 复用归档或 raw 文件。 |

## 已运行验证

```text
npm run validate:vendor-contact-receipts
  vendor-outbound build/check: PASS，3 templates，negative self-tests 4/4
  reproducible ID: sha256:c8f986991f01b0f097d9af7335324b83c64c87e5b4e85a31ce50013fd6b0517c
  contact receipt validator: PASS，11/11 checks
  actual receipts: 0；submitted: 0
  isolated self-test: PASS，2/2（complete file closure；tamper rejection）
```

校验命令成功只表示空记录基线、结构向量和隔离 fixture 通过；它没有生成供应商侧提交事件。

## 关键门的证据

### 1. 本地文件完整性与可复算性

- `scripts/prepare-vendor-contact-receipt.mjs:55-56,78-96` 将当前 outbound 副本复制至 `build/vendor-contact-receipts/<receipt-id>/outbound/`，在 staging 中写草稿和清单后 rename。
- `scripts/validate-vendor-contact-receipts.mjs:52-75` 对归档 Manifest 的 canonical core 重算 `reproducibleId`，并固定外发包仍为 `PREPARED_NOT_SENT` / `MANUAL_OFFICIAL_ENTRY_ONLY`。
- `scripts/validate-vendor-contact-receipts.mjs:266-283` 对记录声明的归档 Manifest、邮件与全部 raw artifact 逐项读取并比对 bytes/SHA-256。
- `scripts/test-vendor-contact-receipts.mjs:98-106` 证明已归档的 `sent.eml` 改字节后会被拒绝。

这组检查足以支撑“本地字节闭环”这一较窄结论。归档验证使用 `recordManifest`（`validate-vendor-contact-receipts.mjs:267-285`），而非当前 `build/vendor-outbound-v1` 的 Manifest，因此当前 bundle 重建通常不会改变已归档记录的判定。

### 2. `BOARD_TARGET` 与付款门

- Schema 将 `targetBindingEffect` 固定为 `NONE_CONTACT_ONLY`，将 `paymentEffect` 固定为 `NONE_AWAIT_VENDOR_RESPONSE`（`hardware/evt0/vendor-contact-receipts-v1/schema.json:135-136`）。
- `structurallySubmitted()` 重复断言上述常量，并要求 `AWAITING_RESPONSE` + 唯一 blocker `SUPPLIER_RESPONSE_PENDING`（`scripts/validate-vendor-contact-receipts.mjs:129-133`）。
- 外发 Manifest 的 `replyPolicy` 同时固定 `NONE_VENDOR_CLAIM_ONLY` 和 `NOT_GRANTED_BY_THIS_BUNDLE`（`scripts/validate-vendor-contact-receipts.mjs:65-75`）；外发构建器还检查 PCBA 回件付款门（`scripts/build-vendor-outbound.mjs:209-229`）。

所以，**该回执合同本身**不会以 `submittedReceiptCount` 为依据建立目标绑定或付款授权。仓库级防护仍应在最终集成验证中同时断言 target-binding 与采购/BOM 状态未被此工作包改变。

## 发现与风险

### R1 — 高：`SUBMITTED` 代表“操作员提供了本地文件”，不代表可独立核验的真实外部提交

`structurallySubmitted()` 仅要求：状态、时间窗口、任意 `https://` URL、非空收件人字符串、已引用 raw artifact 和局部字段匹配（`scripts/validate-vendor-contact-receipts.mjs:99-133`）。`transportReference` 在 Schema 允许 `null`（`schema.json:99-114`），并且结构判定没有要求它非空或与 artifact 内容相符。

`officialEntryUrl` 只检查 `https://` 前缀（`validate-vendor-contact-receipts.mjs:111-113`）；`sourceRefs` 只检查 ID 存在于全局台账（`260-262`），未绑定该 URL、收件人或当日页面 artifact。`submissionArtifactRefs` 只检查 ID 可解析（`86-89,119-120,264-265`），未检查 `.eml` 的可验证邮件头、表单确认编号、目标地址、发送时间或服务端签名。

自检本身展示了这个差距：它用 `https://example.invalid/contact`、`SYNTHETIC-FIXTURE` 和两段合成文本创建 `SUBMITTED` 记录（`scripts/test-vendor-contact-receipts.mjs:42-45,61-95`），然后把该 fixture 计为 `submitted: 1`（`98-100`）。该行为适合验证文件闭环，不适合作为真实供应商交付证明。

**影响：** 在真实记录为零的当前状态下，所有实际发送、供应商已接收、供应商已阅读、供应商已回复、付款资格和目标绑定均保持 PENDING。即使将来有记录，当前格式支持的强度也应表述为“本地人工提交证据已归档”，而不是“真实提交已独立证明”。

### R2 — 高：路径只做仓库包含校验，未绑定 receipt 自身目录

Schema 只要求 raw artifact 路径以 `build/vendor-contact-receipts/` 开头（`schema.json:125-132`）。`verifyFileEvidence()` 只验证解析后的路径留在仓库根内（`validate-vendor-contact-receipts.mjs:136-153`）。对于 Manifest 路径，结构检查在规范化前只做字符串 `startsWith` / `endsWith`（`102-126`）。

例如，一个手工记录可声明：

```text
receiptId = R1
manifestPath = build/vendor-contact-receipts/R1/outbound/../../R0/outbound/bundle-manifest.json
```

该字符串满足前缀/后缀检查；`path.resolve()` 则读取 `R0` 的归档 Manifest。raw artifact 也可指向另一份 receipt 的目录。这样会绕开“每份回执使用自己的不可变归档副本”的目录归属要求，尽管 bytes/SHA-256 仍能匹配所引用的旧文件。

**影响：** 当前 bundle 漂移隔离机制对按准备命令生成的正常路径有效；面对手动回执文件时，历史归档的 receipt 所有权并未被强制。

### R3 — 中：来源、端点、收件人、回执文件之间缺少交叉绑定

有效记录未要求 `document.sourceRefs` 等于该归档消息的 `sourceRefs`，也未要求 `officialEntryUrl` / `recipientValue` 出现在当日官方联系页 artifact 或已归档 recipient-entry 文件中。加上 R1 的任意 raw 语义，此处会让“官方入口已当日复核”的主张主要依赖人工填写。

### R4 — 中：重复 ID 和时间边界未拒绝

记录扫描按文件名读取，未校验文件名与 `receiptId` 一致，也未拒绝多个文件使用同一 `receiptId`（`validate-vendor-contact-receipts.mjs:245-285`）；报告可将重复 ID 计入 submitted 数量。`verifiedAt <= sentAt <= verifiedAt+24h` 有检查（`104-114`），但没有“发送时间不得位于验证运行时间之后”的边界。两项均会削弱审计报表的统计可信度。

### R5 — 低：准备程序的强保证依赖 npm 包装命令

`npm run prepare:vendor-contact-receipt` 先刷新来源并重建/校验 outbound；直接运行 `node scripts/prepare-vendor-contact-receipt.mjs` 时，该脚本本身只读取既有 `build/vendor-outbound-v1`，没有再次调用完整 outbound 校验。正常操作路径已经覆盖该点；直调用路径应保留为受控维护操作。

## 建议

1. **在 R1/R2 修复前，保持当前结论为 `PREPARED_NOT_SENT` / `PENDING_SEND`，不把本合同结果作为采购、付款或 `BOARD_TARGET` 的门槛释放依据。**
2. 为所有记录字段采用规范化、无 `..` 的 receipt-bound 路径规则：Manifest 必须恰等于 `build/vendor-contact-receipts/<receiptId>/outbound/bundle-manifest.json`；邮件与所有 raw artifact 必须位于相同 `<receiptId>/` 根下；同时限制 `receiptId` 字符集并校验文件名匹配。
3. 将“提交”拆成两个显式证据等级：`LOCAL_OPERATOR_EVIDENCE` 与 `TRANSPORT_CONFIRMED`。后者要求非空 `transportReference`，并规定 channel-specific 可验证字段（导出的 sent-mail headers / Message-ID、网页确认号、FAE 工单号等）。
4. 让 `sourceRefs`、当日官方入口 artifact、recipient-entry 与 `officialEntryUrl` / `recipientValue` 形成相互引用；校验其 URL/收件方式一致。
5. 在硬件总验收中追加外部不变量检查：receipt 新增后 `target-binding`、BOM 发布/付款授权、`BOARD_TARGET` 均保持原状态，直到既有 Vendor Evidence 与物理样本门分别通过。
6. 增加负向测试：跨 receipt `../` Manifest/raw 路径、重复 receipt ID、空 `transportReference`、未关联官方 URL、未来 `sentAt`。另增加历史 archive 在当前 outbound 重建后的独立复验 fixture。

## PENDING 项

- 真实 receipt 文件：`0`
- `submittedReceiptCount`：`0`
- 供应商回件：`0`
- `READY_TO_BUY`：`0`
- `BOARD_TARGET`：仍为 `UNRESOLVED`
- 付款授权、物理样品、五元组、BOM release：均保持 PENDING
