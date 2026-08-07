# Benchmark Seller Evidence v1

这个合同把“商品页面看起来相似”与“同一待发实物已被卖家原件闭合”分开。首个 profile 是
`REF2-BABYBUS-G4-446637-SAME-ITEM-V1`；以后出现新的对标候选时，优先新增 profile 和记录，复用同一
schema、原件格式、验证器与准备命令。

## 边界

- 当前包只处理消费级对标样机的付款前身份证据。
- `EVIDENCE_COMPLETE_FOR_HUMAN_REVIEW` 只表示资料齐全到可交给采购人员复核，不产生付款授权。
- 所有记录固定为 `targetBindingEffect=NONE_BENCHMARK_ONLY`、`adapterEffect=NONE`、
  `releaseGateEffect=NONE`。
- 消费品包装、卖家文字和照片不产生 `BOARD_MPN / PCB_REV / HEAD_MPN / HEAD_REV / FW_VERSION`
  五元组，也不解锁芯片级 EDA、BOM 或板相关采购。
- 缺失字段保持 `PENDING`/`null`，不从营销图、搜索摘要或相似标题补齐。

## 单一事实源

- `gate-catalog.json`：profile、来源、请求身份和每项证据门。
- `schema.json`：记录和原件元数据的结构合同。
- `record.template.json`：无事实模板。
- `records/<recordId>.json`：人工取得原始回件后的记录；文件名必须等于 `recordId`。
- `build/benchmark-seller-evidence/<recordId>/raw/`：该记录独占的卖家原件和平台导出件。

不同记录之间不得复用 raw 路径或文件 SHA-256。一个原视频可以在同一记录内支持多项门，但每个
`PASS` 都必须至少引用一种 catalog 允许的 artifact kind 与 provenance。

## 准备 REF2 工作区

```powershell
npm run prepare:benchmark-seller-evidence -- `
  --profile-id REF2-BABYBUS-G4-446637-SAME-ITEM-V1 `
  --record-id REF2-SELLER-EVIDENCE-20260804-01
```

命令只创建：

```text
build/benchmark-seller-evidence/<recordId>/
  SELLER-REQUEST.txt
  REQUEST-CHECKLIST.md
  record.draft.json
  source-manifest.json
  raw/
```

它不会发送消息、改变采购状态、授权付款或修改目标绑定。

## 人工回件后

1. 保存实际发送导出件、卖家聊天导出件、未转码原图/原视频到该记录自己的 `raw/`。
2. 在 draft 中逐文件填写 bytes、SHA-256、mediaType、capturedAt、kind 与 provenance。
3. 填写实际店内 SKU、卖家、发货主体、库存描述、包装条码、批次、序列号前后缀、版本和点读物。
4. 逐项设置 `PENDING/PASS/FAIL`；`PASS` 必须引用原件。
5. 将记录复制到 `records/<recordId>.json` 并运行：

```powershell
npm run validate:benchmark-seller-evidence
```

只有完整闭合的记录可标记 `EVIDENCE_COMPLETE_FOR_HUMAN_REVIEW`，随后仍由人工做采购判断和下单。到货实物另走
`intake-v1`，不继承卖家回件之外的内部硬件事实。
