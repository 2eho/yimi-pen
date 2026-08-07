# REF2 Benchmark Seller Evidence v1

> 工作包：`HW-BENCHMARK-SELLER-EVIDENCE-V1`
> 收口日期：2026-08-04
> 范围：为 `REF2` 建立“同一待发商品”的卖家原件合同、人工请求、独占归档、哈希复算和人工复核门；本包没有发送消息、没有收到卖家回件、没有下单或付款，也没有修改 `BOARD_TARGET`、BOM、EDA、软件或 ReleaseGate。

## 1. 稳定模块保护

本包只新增 `hardware/evt0/benchmark-seller-evidence-v1/`、三个独立脚本、聚合验证入口和本报告。
以下稳定区保持原样：

- HardwareSystem 12 块/18 接口拓扑、`target-binding.json` 与板级 adapter；
- `purchase-plan.csv` 的 `REF1–REF3` 状态和全部板相关采购门；
- `vendor-evidence-v1` 的 MB1 五元组/两套同版样品语义；
- `vendor-contact-receipts-v1` 的实际发送回执语义；
- `intake-v1` 的到货观察与测量语义；
- BOM revision、嘉立创 EDA、固件和 `packages/*/src`。

独立合同的必要性是避免把供应商主板询证、消息已发送、消费品卖家回件和到货实物四类不同事实混入一个
`READY_TO_BUY` 判断。

## 2. 一手与零售证据复核

### 2.1 官方产品线事实

[宝宝巴士官方帮助中心](https://book.babybus.com/help-center/) 本轮复核仍为 `200`、`56,144` bytes、
SHA-256 `9815C1B1BB723C86D793285BDFD5607332BAF1D7ADE1FD923DBE20BC6406A0A5`，与
`SRC-BENCH-JOJO-O-001` 一致。页面把 `G4` 列为当前唯一在售代际。

同一官方表还显示 `G3` 和 `G4` 都有 `32G / 2.4GHz WiFi / Type-C`。所以这三个消费参数不足以独立
排除 G3；`32GB + WiFi + Type-C = G4` 不进入合同事实。

### 2.2 零售页面观察

[九机商品 446637](https://www.9ji.com/product/446637.html) 当前动态页面仍可读到 `ppid=446637`、
“宝宝巴士 jojo 点读笔 基础认知套装”、`32GB`、页面字段 `110329` 和套装配置文字，但响应在短时间内
发生变化且没有发布版本/ETag；未登录浏览器落入登录层，也没有绑定实际发货门店、库存或待发实物。

现有台账 `SRC-BENCH-JOJO-R-001` 只锁定此前归档响应：`659,857` bytes、SHA-256
`37E341DE29807F7027B3A3B216E79417D27C8C71BF961CE3F10791A1FDC1254E`。profile 明确限制其用途：

- `446637` 与 `32GB` 是零售条目字段；
- `110329` 分类为 `RETAIL_LISTING_FIELD_ONLY`，对真实包装条码的证明效果为 `NONE`；
- 营销图中的 JOJO/赳赳 WiFi 文字不证明 G4、批次、序列号或待发件。

页面再刷新时要建立经过复核的新 profile revision；不把动态 hash 静默继承为同一版本。

## 3. 仍待卖家闭合的等式

```text
订单/店内 SKU 与来源商品号 446637 的关系
= 同一实际待发件
= 包装/笔身/开机页可复核的 G4
= 真实包装条码、批次与可追溯 SN 前后缀
= 基础认知套装 32GB 的全部点读物
= 卖家书面确认照片/视频即待发物且不替代
```

本轮没有取得上述任一卖家原件，`REF2` 继续为 `SELLER_PHOTO_REQUIRED`。

## 4. 可复用合同

`gate-catalog.json` 当前包含 1 个 profile 和 11 个证据门：

1. 商品、库存与发货主体；
2. 包装六面；
3. 真实包装条码与批次；
4. 笔身背标与 SN 前后缀；
5. 同一设备开机型号/版本显示；
6. 全部可点读物、贴纸、线材和说明书；
7. 书面无替代确认；
8. **同一待发物连续原视频绑定**；
9. 实物可见的 G4 代际；
10. `446637` 新旧 SKU 对应关系；
11. `32GB` 套装与同一支笔绑定。

关键不变量：

- 每个 `PASS` 必须引用本记录独占 raw 目录内、kind/provenance 被 catalog 接受的真实文件；
- 不同记录之间 raw 路径和 SHA-256 均不可复用；
- 同一待发物绑定只接受 `SELLER_ORIGINAL_VIDEO`；
- G4 物理门不接受单独的卖家文字；
- 记录文件名必须等于 `recordId`，路径 resolve 后仍须位于该 record 的 raw 根；
- source baseline 的 ID、grade、bytes 和 SHA-256 必须与证据台账逐项一致；
- 完整状态名为 `EVIDENCE_COMPLETE_FOR_HUMAN_REVIEW`，不含 `READY_TO_BUY` 语义。

所有记录固定：

```text
targetBindingEffect       = NONE_BENCHMARK_ONLY
adapterEffect             = NONE
releaseGateEffect         = NONE
purchaseAuthorizationEffect = NONE_HUMAN_DECISION_REQUIRED
purchasePlanEffect        = NONE_RECORD_ONLY
intakeEffect              = NONE_UNTIL_RECEIVED_UNIT
```

消费品开机页只记 `bootVersionDisplay`，不把它写成目标板五元组的 `FW_VERSION`。

## 5. 实际待填工作区

已创建：

```text
D:\work\yimi-pen\build\benchmark-seller-evidence\REF2-SELLER-EVIDENCE-20260804-01\
```

| 文件 | bytes | SHA-256 |
|---|---:|---|
| `SELLER-REQUEST.txt` | 2,180 | `91d10ad7f3a6f77018fe711ab9726b7a20ce42dc483554460fe5a8d5cb207118` |
| `REQUEST-CHECKLIST.md` | 2,260 | `f25a4d53355d4fa875fb68c91ff097fcec3ee76c13da07c72b1a3c5223b7a53b` |
| `record.draft.json` | 4,391 | `e2abb00ae2a5755c0fcd3dc8f75301b5bcfb4a920ee34d346975f59528da2006` |
| `source-manifest.json` | 3,351 | `19fdf6162268b5c3d04e37a52d62532120749e5cc8671d4dfeeb14c464c5bb00` |

当前真实状态：

```text
request     = PREPARED_NOT_SENT
response    = PENDING
raw files   = 0
records     = 0
complete    = 0
payment auth / BOARD_TARGET / adapter / ReleaseGate / intake effects = 0 / 0 / 0 / 0 / 0
```

## 6. 机器验证

`npm run validate:benchmark-seller-evidence` 当前结果：

- 合同/模板/profile/source baseline：20/20；
- 真实 records：0；完整 records：0；
- preparation/isolated self-test：9/9；
- 正向向量：完整 synthetic 原件集可进入人工复核状态；
- 负向向量：只改 decision、跨 record 路径、文件 hash 篡改、effect 晋级和未来时间线均被拒绝；
- prep 自检还证明重复工作区拒绝，并复算 `purchase-plan.csv` 与 `target-binding.json` 在准备前后未变化。

synthetic 向量只测试合同，不形成商品、付款或物理事实。

## 7. 高复用与低维护收益

以后新增 `REF1`、替换后的 `REF3` 或其他成熟点读笔时，优先只新增 profile：

```text
source baseline + requested identity + requirement set
  -> 共用 schema
  -> 共用 prepare 命令
  -> 共用独占 raw/哈希规则
  -> 共用人工复核状态机
  -> 到货后转入既有 intake-v1
```

不复制供应商五元组合同，不扩展 HardwareSystem，不建立产品专用脚本。变化被收敛在 profile 与单条 record；
稳定原件格式、负向测试和到货入口继续复用。

## 8. 软件双线同步

软件 owner 锚点最新已验收包仍为 `SW-ASSET-VAULT-MAINTENANCE-01`：21/21，报告 SHA-256
`c56e2acd468518334d8fb299ceb7d99aa0c4135f6c65b1ee810e067dc9b164df`。本硬件包收口复读时还观察到
一个更新于 owner 锚点的 `companion-family-workspace-validation/report.json`：4,824 bytes、SHA-256
`0cdfd87e607d48dbfb0226601451409e9a4f15d18ea613eb9767f690ae80b8e2`、30/30；其边界声明
`hardwareImpact=NONE`。由于软件 owner 锚点尚未发布该包收口，这里只记为进行中验收工件，不替软件线晋级状态。

本包只收集消费品 benchmark 原件，不新增 codec、storage、USB、OID event、控制、状态、诊断或 board
adapter 假设；软件影响为 `NONE`，也不产生 ReleaseGate receipt。

## 9. 人工动作

1. 打开 `SELLER-REQUEST.txt`，通过实际卖家/发货方的可导出文字渠道发送；
2. 保存实际发送导出、卖家回复导出、未转码照片和连续原视频到该 record 的 `raw/`；
3. 视频按“订单/待发说明 → 包装六面与条码 → 开箱 → 背标/SN → 开机版本页 → 全套点读物”连续拍摄；
4. 逐项填写 draft 并运行 `npm run validate:benchmark-seller-evidence`；
5. 资料完整后只进入人工采购复核；付款、下单和到货 intake 仍是后续独立动作。

并行主关键路径仍是执行三份 MB1 `SEND-CHECKLIST.txt` 并保存 Message-ID/确认号/FAE 工单；该动作对
`BOARD_TARGET` 的解锁收益高于 benchmark 对标购买。
