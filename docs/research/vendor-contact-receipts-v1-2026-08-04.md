# MB1 供应商发送回执合同 v1

> 工作包：`HW-MB1-CONTACT-RECEIPT-V1`
> 日期：2026-08-04
> 当前事实：外发模板 3 份；真实发送回执 0；供应商回件 0；`BOARD_TARGET=UNRESOLVED`

## 1. 为什么增加这一层

既有 `vendor-outbound-v1` 有意固定为 `PREPARED_NOT_SENT`，既有 `vendor-evidence-v1` 则从真实供应商回件开始。两者之间原先缺少可机检的提交证据，因此“文本已准备”“人员已发送”“供应商已回复”容易在手工记录中混为一件事。

本包补齐中间合同，同时保持两侧稳定语义：

```text
确定性外发包 PREPARED_NOT_SENT
  -> 每次发送的不可变 bundle 归档
  -> 当日官方入口原件 + 实际提交原件
  -> AWAITING_RESPONSE
  -> 供应商原始回件
  -> Vendor Evidence v1
```

`AWAITING_RESPONSE` 只表示提交动作具有本地文件闭包。它的目标绑定效果固定为
`NONE_CONTACT_ONLY`，付款效果固定为 `NONE_AWAIT_VENDOR_RESPONSE`。

## 2. 复用边界

| 层 | 稳定资产 | 变化收敛点 |
|---|---|---|
| 询证内容 | `vendor-outbound-v1` 的 message、附件清单和 bundle manifest | 新供应商新增 message template |
| 单次发送 | `vendor-contact-receipts-v1/schema.json` 与统一校验器 | 每次新增一个 receipt record 和忽略提交的原始文件目录 |
| 供应商回复 | 既有 `vendor-evidence-v1` 的 M01–M08、A01–A10、五元组和付款门 | 每次新增一个 response record |
| 板级冻结 | 既有 intake、target-binding 和 BOM revision | 只在两套同版实物门通过后新增绑定/revision |

因此换供应商、换联系渠道或重复追问时只增加 receipt；HardwareSystem、板级接口、BOM、EDA 和软件均保持原样。

## 3. 新增资产

- `hardware/evt0/vendor-contact-receipts-v1/schema.json`
- `hardware/evt0/vendor-contact-receipts-v1/receipt.template.json`
- `hardware/evt0/vendor-contact-receipts-v1/records/`
- `scripts/prepare-vendor-contact-receipt.mjs`
- `scripts/validate-vendor-contact-receipts.mjs`
- `scripts/test-vendor-contact-receipts.mjs`

准备脚本会把当时的完整外发 bundle 原样归档到本次 receipt 工作区，再生成保持
`PENDING_SEND` 的草稿和人工清单。它采用 staging 目录后原子改名，已存在的 receipt ID 会直接停止，避免覆盖历史发送证据。

历史 receipt 校验自己的归档 manifest，而不是依赖会随资料更新而变化的当前 build。这样后续更新官方资料、问题文本或 source ledger 时，旧回执仍绑定实际发送的精确字节。

## 4. 证据门

一份真实 receipt 进入 `AWAITING_RESPONSE` 前必须同时满足：

1. message ID 与 candidate ID 在归档 manifest 中一致；
2. bundle `reproducibleId`、manifest、邮件与 `recipient-entry.json` 的 bytes/SHA-256 闭合；
3. `sourceRefs` 精确匹配归档消息，官方 URL 和邮箱/表单路由同时受 O 级来源与归档 recipient entry 约束；
4. 发送时间不晚于当前时间，渠道具有非空 Message-ID/确认号/FAE 工单号和对应 `.eml`、HTML、PDF、PNG 或 JSON 原件；
5. 所有 artifact 文件真实存在，声明 bytes/SHA-256 与当前字节一致；
6. manifest/message/recipient/raw 路径规范化后全部位于该 receipt 的独占目录，receipt ID、文件名和记录全局唯一；
7. decision 保留 `SUPPLIER_RESPONSE_PENDING`；
8. target/payment effect 保持 `NONE`。

状态单独提升、缺官方入口证据、缺提交证据、message/candidate 串线、越权目标绑定以及任一文件篡改均由校验门拒绝。

## 5. 当前复算结果

```powershell
npm run refresh:vendor-contact-sources
npm run validate:vendor-outbound
npm run validate:vendor-contact-receipts
```

本轮结果：

- 外发包：3 templates，4/4 负向门，`PREPARED_NOT_SENT`；
- Contact Receipt 合同：16/16；
- 隔离文件闭包自检：3/3（完整回执通过、重复 ID 拒绝、原始文件篡改拒绝）；
- 真实 receipt records：0；
- `submittedReceiptCount`：0；
- target/payment effect：`NONE`。

报告：`build/vendor-contact-receipts-validation.json`。

## 6. 下一次真实操作

以 Ztron 为例：

```powershell
npm run validate:vendor-outbound
npm run prepare:vendor-contact-receipt -- `
  --message-id MB1-OUT-ZTRON-LOCAL `
  --receipt-id 20260804-ZTRON-01
```

随后严格按生成的 `SEND-CHECKLIST.txt` 保存官方入口原件、人工发送、导出提交原件并建立 record。邮件填写实际 Message-ID；网页/FAE 填确认号或工单号。校验通过后状态只到 `AWAITING_RESPONSE`，仍不代表供应商阅读或回复；收到原始回件后再进入既有 Vendor Evidence v1。

## 7. 收益复排影响

本包消除了“准备完成”与“已经提交”之间的记录歧义，并把重复供应商沟通变成可复用合同；它没有替代真实外发。因此候选首位仍是 `HW-MB1-SEND-AND-FREEZE`。精确标杆 SKU 补证、实验室仪器实物登记和共享 EDA 运行态继续作为并行候选，芯片级设计门保持锁定。
