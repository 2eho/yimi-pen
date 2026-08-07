# Gen1 EVT-0 硬件证据与采购就绪审计（2026-08-04）

> 审计范围：`Gen1 EVT-0` 的成熟产品基准、`MB1` 一体主板/OID 套件、付款前询证和来料 intake。
> 审计时点：2026-08-04（JST）；本轮网络复核发生在 `2026-08-03T19:11–19:14Z`。
> 结论：桌面资料、版本化目标绑定、采购门和 intake 方法已经可复用；没有一项资料或实物把 `BOARD_TARGET`、MB1 五元组、目标 BOM 或任何 benchmark 样品推进到已验证状态。

本文件是现状审计，不创建采购订单、外发询证、接收样品、执行测量或变更任何 target binding。文中 `READY_TO_BUY` / `READY_TO_INQUIRE` 是现有采购表的动作资格，不是“已购买”或“已发送”的事实。

> **后续证据修正（同日）：** [REF1–REF3 精确 SKU 复核](./benchmark-sku-evidence-2026-08-04.md)
> 已证明三项都未达到付款门，并已将采购表修正为 `SKU_EVIDENCE_REQUIRED /
> SELLER_PHOTO_REQUIRED / REPLACEMENT_REQUIRED`。本审计下文保留的是修正前快照；当前动作以
> `hardware/evt0/purchase-plan.csv` 和上述复核报告为准。

## 1. 审计输入与当前性复核

已逐项检查以下当前仓库输入：

- [Gen1 EVT-0 单件目标样机基线](../hardware-gen1-p0.md)；
- [单件采购清单](./gen1-evt0-single-buy.md)；
- [MB1 付款前询证执行包](./gen1-mb1-prepay-pack.md)；
- [成熟产品对标](./mature-products-gen1-p0.md)；
- [`purchase-plan.csv`](../../hardware/evt0/purchase-plan.csv)、[`evidence-sources.json`](../../hardware/evt0/evidence-sources.json)、[`board-evidence-matrix.csv`](../../hardware/evt0/board-evidence-matrix.csv) 与 [`bom-lock.csv`](../../hardware/evt0/bom-lock.csv)；
- [`intake-v1/`](../../hardware/evt0/intake-v1/)、[`target-binding.json`](../../hardware/evt0/hardware-system-v1/target-binding.json)。

`evidence-sources.json` 的最新已登记抓取时点为 `2026-08-04T00:21:51+09:00`。本轮仅对会影响候选入口或官方料号核对的官方 URL/API 作了独立 HTTP/字节/哈希复核；不把网页可访问性提升为样品或供货证据。

| 官方来源 | 本轮结果 | 当前可使用的事实边界 |
|---|---|---|
| [组创点读笔方案](https://www.ztrontech.com/solutions/1.html)（`SRC-OID-001`） | HTTP 200、43,579 bytes、SHA-256 与登记值 `01ADC611…C5B42E6` 一致 | 是完整 PCBA/OID 询证入口与方案级架构参考；不含可付款的 `BOARD_MPN`、PCB revision 或两件同版样品证明。 |
| [组创智能 WiFi 点读笔](https://www.ztrontech.com/educational1/118.html)（`SRC-OID-002`）与 [WiFi/BLE 对比](https://www.ztrontech.com/educational1/119.html)（`SRC-OID-003`） | 均 HTTP 200；分别 39,886 / 41,807 bytes，SHA-256 与登记值一致 | 仅保留功能分支和供应商架构主张；不证明目标机的离线、工具、功耗或同 revision 供货。 |
| [春苗点读笔技术方案](https://www.szdianjiao.com/articles/readpen.html)（`SRC-OID-011`） | HTTP 200、8,635 bytes、SHA-256 `5020EC8D…C84013F` 与登记值一致 | 是第二家 PCBA/OID 询证入口；网页中方案级/SDK/工具主张仍须回收为具体候选的书面附件。 |
| 松翰官方 Decoder / Sensor Module API（`SRC-OID-004…007`） | 四个固定 POST 响应均 HTTP 200，字节数与 SHA-256 均与登记值一致 | Decoder 分类仍列 `OID2/OID3/OID3S/OID4`；Decoder List 为 `SN95310/SN95350/SN95360`；Sensor Module List 为 8 个家族，含 `SNM9S5X30BC2100A`。这只适合作为供应商准确 MPN 的交叉核对。 |
| [SN953x0 DS V1.5](https://www.sonix.com.tw/webapi/fl200024/SN953x0_DS_V1.5.pdf)、[SNM9S5x30(B)C2100A DS V1.1](https://www.sonix.com.tw/webapi/fl219813/SNM9S5x30(B)C2100A_DS_V1.1.pdf)、[2-wire Manual V1.3](https://www.sonix.com.tw/webapi/fl218298/SNM9S53xx_54xx_2-wire_Int_Manual_V1.3.pdf)（`SRC-OID-008…010`） | 三个 PDF 均 HTTP 200，且分别与登记的 `B10EB476…2AF338`、`46A0B12E…2A662`、`BD869E63…4E7E39` 一致 | 可用于核对候选的芯片/模组、电气与接口资料；不表明某个 PCBA 使用该芯片/模组，也不表明库存、head revision 或软件授权。 |
| [讯飞 X8 Pro 官方商品页](https://www.xunfei.cn/goods?goodsId=2223)（`SRC-XF-001`） | HTTP 200、740,004 bytes；本轮 SHA-256 `83C65B43…DC623C` 与既存快照 `40258D62…0E0348` 不同 | 页面仍可作“官方商品页存在”的交互参照入口；发生了展示页快照漂移，不能从本轮 fetch 反推出精确 SKU、固件或实际 UI 行为。 |

成熟产品中的 PIYO 与 JoJo 还没有同等强度的一手产品身份证据：`SRC-PIYO-001` 是已保留的二手参考，当前登记为 HTTP 403/0 bytes；`SRC-JOJO-001` 是零售参考，当前登记为 HTTP 405/0 bytes。二者可支持采购假设，不能替代卖家原图、包装铭牌、精确 SKU 或到货测量。

## 2. 现有证据状态

| 范围 | 当前状态 | 已有可复用资产 | 尚未成立的事实 |
|---|---|---|---|
| `BOARD_TARGET` | `UNRESOLVED` | `target-binding.json` 将目标选择、两件同版最低数量和 release gate 明确化 | 没有 target board/head/firmware 身份；18/18 接口均为 `TARGET_EVIDENCE_PENDING`。 |
| EDA | `SYSTEM_SKELETON_ONLY`，`chipLevelReady=false` | 稳定拓扑和接口标签可复用 | symbol、pin mapping、physical net、power rail value、connector 与 PCB layout 均仍锁定。 |
| MB1 候选矩阵 | 3 行 `REFERENCE_ONLY`、1 行 `EVIDENCE_REQUIRED` | 供应商线索和统一的入场字段已经分开管理 | 没有任一行具有完整、可验证的五元组或两件匹配实物。 |
| MB1 intake | `MB1-PENDING-EXACT-KIT` | 36 个观察字段、20 个强制测试和 9 个 blocker 已结构化 | 期望 2 套，当前样品数 0；36/36 字段、20/20 测试均 `PENDING`；`hardware/evt0/intake-v1/records/` 目前不存在。 |
| Benchmark intake | `REF1-PENDING-EXACT-SKU` | 15 个观察字段、7 项 benchmark 测试和标准状态机 | 样品数 0，15/15 字段与 7/7 测试均 `PENDING`；没有任何实际 SKU 记录。 |
| BOM | 9 行 `BLOCKED`、4 行 `CANDIDATE`、0 行 `LOCKED` | 自研分支候选料号已被清晰限定为候选/分支专用 | `BOM-REV-A` 未发布；MB1/M1、存储、电芯、扬声器、USB、外壳和自研 PCB 均不能冻结。 |

这意味着当前能关闭的是**方法与门**，不是产品或实物性能。`purchase-plan.csv` 中的状态也保持如下含义：

- `REF1`、`REF2`、`REF3` 和 `REF4` 是 `READY_TO_BUY`；每一个仍受精确 SKU、卖家实拍或借用优先等前置条件约束。
- `MB1` 是 `READY_TO_INQUIRE`，不是 `READY_TO_BUY`；付款门需要完整书面回件。
- `LAB1…LAB6` 仅在本地缺少合格仪器时 `READY_TO_BUY_IF_MISSING`；`LAB7` 以及 `SD1/B1/SP1/IO1/ENC1` 都是 `WAIT_BOARD_LOCK`。
- `X1…X4` 是 `DO_NOT_BUY`，因此开发板拼接、提前自研料、随机 OID 模组和未匹配外围件没有进入采购路线。

## 3. MB1 五元组与付款门缺口

目标五元组是 `BOARD_MPN / PCB_REV / HEAD_MPN / HEAD_REV / FW_VERSION`。当前 `MB1-CANDIDATE-A` 的五项全部为 `PENDING`；它在矩阵中的状态为 `EVIDENCE_REQUIRED`，而不是一个已付款或已到货的 candidate。

| 五元组字段 | `MB1-CANDIDATE-A` | 公开方案线索的最高粒度 | 仍需的关闭证据 |
|---|---|---|---|
| `BOARD_MPN` | `PENDING` | 组创/春苗均是方案级页面；三条参考行均为 `UNPUBLISHED` | 供应商书面料号、两件待发板标签、正反面原图、2D 图和发货清单。 |
| `PCB_REV` | `PENDING` | 三条参考行均为 `UNPUBLISHED` | 与 `BOARD_MPN` 同源的 revision 标记，且两件一致。 |
| `HEAD_MPN` | `PENDING` | 仅有 `95500_OR_SONIX3_VENDOR_CLAIM`、`SN95500_VENDOR_CLAIM`、`CMOID_VENDOR_CLAIM` 等非冻结占位；松翰官方目录提供可核对的器件/模组家族 | 完整 optical head MPN、镜头/补光/FPC/滤光叠层身份和实际组合。 |
| `HEAD_REV` | `PENDING` | 所有参考行 `UNPUBLISHED` | 两件同 revision 的 head 标签/图片、机械图、工作距、角度、调焦/跌落复校方法。 |
| `FW_VERSION` | `PENDING` | 所有参考行 `UNPUBLISHED` | 固件/SDK/码工具/build-flash-log 工具版本及其文件 SHA-256，且与两板开机/日志一致。 |

因此任何 `95500`、`SN95500`、“三代/四代”或 `CMOID` 文字都只能保留为询证交叉检索词，不能填写为 MB1 的 `HEAD_MPN`，更不能代替 revision。松翰官方 API 进一步证明可用型号/家族存在，但没有把它们绑定到组创、春苗或 `MB1-CANDIDATE-A`。

### 付款前必须由外部回件关闭的项目

| 手工/外部 gate | 最小输入 | 可判定的输出 | 当前状态 |
|---|---|---|---|
| `MB1-PREPAY-SEND` | 将现有 [付款前询证执行包](./gen1-mb1-prepay-pack.md) 的 `M01…M08` 与十项附件要求发送给每家候选 | 每个 candidate 独立的、可追溯的书面回件目录 | `READY_TO_SEND`；仓库未记录任何已发送事实。 |
| `MB1-PREPAY-REPLY` | 五元组、两件待发样品正反面/标签/serial、板/头 2D、SDK/工具/哈希、OID/印刷/离线/供货材料 | 十项附件与 `M01…M08` 相互一致；任一缺项保持 gap | `PENDING`。 |
| `MB1-PAYMENT` | 上述回复通过；拒绝随机 revision 与“功能相同”替代 | 对应 candidate 才可从 `EVIDENCE_REQUIRED` 进入待购 | `BLOCKED`。 |
| `KIT-IDENTITY` | 两套到货 kit、封存的付款前材料、标签/serial/板头照片和文件哈希 | 两套五元组逐项相同；不一致则拆成不同 candidate | `PENDING`，样品为 0。 |
| `KIT` 物理/软件基线 | 限流上电、供应商 C reference、24 码、空白负样、离线、日志/时间戳、供电/存储/音频/USB 原始记录 | 20 项 intake 测试逐项可复算；先形成 C/物理基线，再评估 Rust/BSP | 20/20 `PENDING`。 |
| `ACCEPTED_BOARD_TARGET` | 两件同版与所有 blocker 清空，包含供货、PCN/EOL、授权及受影响 test evidence | `targetIdentity` 才可变更，之后才能冻结目标 BOM/CAD/芯片级 EDA | `UNRESOLVED`。 |

## 4. Benchmark 采购与 intake 就绪度

| 项目 | 采购表状态 | 在付款/借用前必须由外部取得 | 到货后的最小 intake | 当前缺口 |
|---|---|---|---|---|
| `REF1` PIYO PEN PW20 32GB 对应版本 | `READY_TO_BUY` | 卖家提供完整 SKU、包装条码、背面铭牌、生产批次、固件/App、配套码书和充电口原图；排除随机版本 | 建立唯一 REF record，保留身份、断网、首音、反馈、控制、声学和耐久的 7 项原始结果 | 仅有二手参考；未取得卖家图片、订单或实物。 |
| `REF2` 宝宝巴士/赳赳 JoJo 32GB WiFi 对应版本 | `READY_TO_BUY` | 精确 SKU、铭牌、固件/App、按键/状态灯、充电口、配套点读物及其版本 | 同一 benchmark method；尤其记录断网、升级、低电反馈和首音 | 仅有零售/详情图参考；未取得卖家图片、订单或实物。 |
| `REF3` 低价 OID 牺牲拆解笔 | `READY_TO_BUY` | 明确品牌型号、铭牌/包装、原配码书实拍和可正常点读的卖家确认 | 先非破坏观察，之后分层照片、尺寸、丝印和电气记录；不把丝印猜测成 MPN | 当前没有锁定型号或样品。 |
| `REF4` 讯飞 X8 Pro | `READY_TO_BUY`，采购策略为“借不到时再买” | 借用/购买前确认商品 ID 2223、完整型号、铭牌、系统版本与配件 | 只记录提示/错误/充电/升级交互，不作为 OID 主板架构或拆机基准 | 官方 URL 可访问但没有借用、购买或实际测量。 |
| `LAB1…LAB6` | `READY_TO_BUY_IF_MISSING` | 用户核对现有仪器是否覆盖限流电源、DMM、卡尺/秤、微距、USB-C 功率和声级能力 | 先做已知负载/尺寸/重量/标尺/校准或交叉检查并登记 serial | 仪器持有、校准和基线结果未在本审计输入中记录。 |

`benchmark-product.template.json` 是 `REF1` 的空模板，不可自动覆盖 `REF2/REF3/REF4`。每个实际 SKU 必须复制成独立记录；模板中的 `PENDING + null` 正确地防止了空白资料被当作实物证据。

## 5. 手工行动顺序与不变约束

1. **先收集 MB1 回件。** 用户或指定采购人员使用现有 `HW-MB1-PREPAY-01` 文本向两家 PCBA 候选发出完全相同的问题；原始邮件、PDF、图片和压缩包应按现有约定归档到 `build/vendor-evidence/<candidate>/<received-at>/raw/`，并记录文件名、字节数与 SHA-256。此审计没有执行该外部动作。
2. **只针对满足付款门的独立 candidate 购买两套。** 两套不是“功能近似”或混 revision 的组合；任何一项五元组差异都拆开 candidate，不以均值或供应商口头答复合并。
3. **并行补齐 benchmark 的卖家原图/精确 SKU。** `REF1/REF2` 的商品页或标题只能作为询证线索；图片不清、码书不清或 SKU 不明时继续保留为待询证，不付款为工程基准样本。
4. **到货后才创建 `intake-v1/records/`。** 先封存包裹、标签、serial、板/头原始照片和随附文件；随后 `KIT-IDENTITY`、限流上电、供应商 C 基线、24 码/负样/离线等记录先于任何 target port 或 PCB 工作。
5. **保持锁定边界。** 在 `ACCEPTED_BOARD_TARGET` 之前，不填写芯片级原理图、引脚映射、电源数值、连接器选型、PCB layout，也不购买 `WAIT_BOARD_LOCK` 部件。自研 PCB 仍需先证明合格一体 PCBA 路线全部失格。

## 6. 重新评分与推荐

评分按 `关键路径解锁 / 证据就绪度 / 实物闭环距离 / 复用累积收益 / 时间成本 / 低返工风险 = 30/20/20/10/10/10`。这是本审计后的工作顺序建议，不替代任何付款或技术 gate。

| 排名 | 候选工作包 | 分项 | 总分 | 推荐理由 |
|---:|---|---|---:|---|
| 1 | `HW-MB1-SEND-AND-FREEZE`：外发询证、核回件、再决定是否购买两套同版 kit | `30/18/20/10/7/9` | **94** | 唯一同时解锁 `BOARD_TARGET`、OID head、接口、BSP、EDA、存储、电源、音频、结构与 HIL 的路径；已有两家官方入口与可复用询证包，但回件/付款仍是外部条件。 |
| 2 | exact benchmark SKU 询证、购买与 intake | `20/18/20/8/7/9` | **82** | 能建立成熟产品的实物、光学、声学、结构和体验基准，但不单独冻结 MB1。 |
| 3 | `HW-LAB-BASELINE`：仅做目标中立仪器/方法/台架准备 | `20/18/16/9/7/6` | **76** | 到货后立即复用；可以在等待供应商回件期间执行，但不猜接口、电压或连接器。 |
| 4 | `HW-EDA-SKELETON`：稳定层级/接口标签复核 | `15/16/6/8/8/4` | **57** | 可复用的系统骨架已有价值，但不能解除 target identity 或物理证据门。 |
| 5 | 芯片级自研 PCB | `10/4/4/4/5/2` | **29** | 一体主板分支尚未失格，MB1 身份与接口仍为空；现在启动会造成最高返工风险。 |

**当前最高收益的下一硬件动作：** 执行 `HW-MB1-SEND-AND-FREEZE` 的外部询证步骤；等待窗口内再执行不依赖 board revision 的 `HW-LAB-BASELINE` 或 benchmark 卖家证据收集。任何回件、卖家原图、到货、测量或版本差异都会使此评分失效并触发重算。

## 7. 审计结论（可核查状态）

- `BOARD_TARGET=UNRESOLVED`，MB1 五元组五项均为 `PENDING`。
- 没有 `intake-v1/records/`，没有供应商回件、购买、到货或测量在本审计输入中得到记录。
- 参考供应商网页、松翰官方目录/API 和数据手册均保持为**官方资料/询证交叉核对**；它们没有升级为 candidate-specific 的供应商书面证据或物理证据。
- `REF1…REF4` 的采购资格不等于精确 SKU 已确认；`MB1` 的 `READY_TO_INQUIRE` 不等于付款资格。
- 现有稳定资产是五元组、目标绑定、BOM 锁定、采购状态机、intake 模板与测试门；新增采购/实物变化应只在独立 candidate、intake record、BOM revision 和受影响验证记录中收敛。
