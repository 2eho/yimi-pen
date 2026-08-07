# Vendor Evidence v1

本目录把 MB1 付款前 `M01–M08` 回答、十项附件、两件待发样品身份和原始文件哈希收敛为
一个候选一个记录。它位于供应商询证与实物 `intake-v1` 之间：

```text
官方/供应商入口
  -> outbound-v1 / PREPARED_NOT_SENT
  -> vendor-contact-receipts-v1 / AWAITING_RESPONSE
  -> 原始供应商邮件、PDF、图片、压缩包
  -> Vendor Evidence v1
  -> READY_TO_BUY（只代表付款门）
  -> 两套实物到货
  -> intake-v1/records
  -> ACCEPTED_BOARD_TARGET
```

`READY_TO_BUY` 仍属于供应商书面证据，`targetBindingEffect` 固定为
`NONE_VENDOR_CLAIM_ONLY`。只有两套实物完成 `intake-v1` 的身份、功能、物理和供货测试后，
`BOARD_TARGET` 才可进入冻结判定。

## 文件

- `schema.json`：严格 JSON Schema；
- `candidate.template.json`：空白候选模板，所有字段保持 `PENDING`；
- `outbound-v1/`：把统一问题、官方入口线索、附件请求和回件归档路径编译成确定性人工外发包；
  固定 `PREPARED_NOT_SENT`，不产生发送、回复、付款或目标绑定事实；
- `../vendor-contact-receipts-v1/`：把每次人工提交绑定到不可变 bundle、同日官方入口和提交原件；
  `AWAITING_RESPONSE` 仍不产生回复、付款或目标绑定事实；
- `records/`：收到真实回件后，每个 candidate/response 独立建立记录；
- 原始文件：放在忽略提交的 `build/vendor-evidence/<candidate>/<received-at>/raw/`；
- 原始文件清单：记录文件名、字节数、SHA-256 与 MIME type，再由记录中的 `artifactRefs` 引用。

## 使用规则

1. 不同供应商、不同板号或不同 revision 建立不同 candidate；
2. 即时消息或口头答复回收为带来源时间的邮件、PDF或原图；
3. `PROVIDED/ANSWERED/RECEIVED` 必须引用原始 artifact；
4. 两件待发样品分别填写五元组和照片引用，五项必须逐项一致；
5. 任一 `M01–M08`、附件或身份项缺失时，decision 保持 `EVIDENCE_REQUIRED`；
6. `READY_TO_BUY` 只允许进入付款决策，不更新 `target-binding.json`；
7. 到货后从 `intake-v1/board-oid-kit.template.json` 建立两件实物记录，并重新核对全部身份。

## 校验

```powershell
npm run validate:vendor-outbound
npm run validate:vendor-contact-receipts
npm run validate:vendor-evidence
```

前两条构建并复核外发包的确定性字节、`PREPARED_NOT_SENT` 边界、发送回执文件闭包与篡改拒绝；第三条验证回件 Schema、
固定问题/附件集合、来源与artifact引用、两件五元组一致性及付款门。报告分别位于
`build/vendor-outbound-v1/` 与 `build/vendor-evidence-validation.json`。
