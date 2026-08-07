# Gen1 成熟产品、OID 与 `BOARD_TARGET` 证据门审计

> 审计日期：2026-08-03  
> 范围：成熟产品基准、OID/一体主板候选、`BOARD_TARGET` 冻结条件和当前官方来源。  
> 结论：桌面资料已经足以冻结**研究方法、候选入场规则和测试方法**；具体产品表现、具体板卡身份、Rust 目标机路线与量产结论仍由供应商文件和精确 revision 实物关闭。

## 1. 本轮复核基线

本轮交叉检查以下仓库基线：

- [成熟产品对标](./mature-products-gen1-p0.md)；
- [OID 主板与代际复核](./oid-board-generation-survey-2026.md)；
- [OID/主板 RFQ](./gen1-p0-oid-rfq.md)；
- [MB1 付款前询证执行包](./gen1-mb1-prepay-pack.md)；
- [产品系统证据台账](./product-system-evidence-2026.md)；
- [`board-evidence-matrix.csv`](../../hardware/evt0/board-evidence-matrix.csv)；
- [`purchase-plan.csv`](../../hardware/evt0/purchase-plan.csv)；
- [`EVT-0 Evidence Intake v1`](../../hardware/evt0/intake-v1/README.md)；
- [`HardwareSystem v1`](../hardware-system-architecture.md)；
- [`BOARD_TARGET Rust/C port 证据包 v1`](../../hardware/evt0/board-port-evidence-v1/README.md)。

2026-08-03 重新取得三份组创官方页面，HTTP 状态、UTF-8 字节数和 SHA-256 与
[`evidence-sources.json`](../../hardware/evt0/evidence-sources.json) 完全一致：

| 来源 | HTTP | 字节 | SHA-256 |
|---|---:|---:|---|
| [点读笔方案](https://www.ztrontech.com/solutions/1.html) | 200 | 43,579 | `01ADC611FD1B00F8E17C97A8A13F285FF1C2B1CD6D33CFB792A23C6D5C5B42E6` |
| [智能 WiFi 点读笔方案](https://www.ztrontech.com/educational1/118.html) | 200 | 39,886 | `6ADB53665DD3D784EA5B61C719C8A48A49481771B67478F1302732F21B5F322B` |
| [蓝牙/WiFi 点读笔技术对比](https://www.ztrontech.com/educational1/119.html) | 200 | 41,807 | `C7BD0B92D7A48023D67A30B05DEA4CA247638D7DAFA49EC37F5708F2EF868DBD` |

这次刷新没有带来精确 PCBA 料号、PCB revision、当前 SDK、构建工具、机械图或
同版供货承诺，因此原有证据等级保持不变。

同日又以固定 POST 请求体复核松翰 OID 官方 API，并锁定原始响应字节：

| 来源 | 结果 | 字节 | SHA-256 |
|---|---|---:|---|
| Decoder Filter，`productLineId=1636` | 分类更新时间 `2026-03-31 11:57:12` | 3,424 | `74FB080D2DBB17C1D236D5BD04831A3053FBE618CCE258D16C2F699A3A075FA5` |
| Sensor Module Filter，`productLineId=4157` | 分类更新时间 `2026-03-31 11:37:22` | 3,434 | `21006C36B7476BFEDF87FD005CBBCB7D586730CB8F61E4B23460A842B42F9E7E` |
| Decoder List | `SN95310 / SN95350 / SN95360` | 1,844 | `14F1640E36C0598315490180914BF8263A8310349113EA3BD56AFCD30462A744` |
| Sensor Module List | 8 个家族，含 `SNM9S5X30BC2100A` | 4,650 | `900D80152C24D924555C1686944A2DE0B4DF882FD3685F14655F18F1B5B35D05` |

配套 `SN953x0 DS V1.5`、`SNM9S5x30(B)C2100A DS V1.1` 和 2-wire Manual
V1.3 也已按 URL、字节和 SHA-256 登记为 `SRC-OID-008…010`。这把询证从营销家族
名收窄到芯片/模组准确身份，但仍未产生完整板卡身份、库存或验证组合。

## 2. 桌面证据已经闭合的部分

这里的“闭合”只表示后续可以据此执行，不表示物理产品已经验证。

| ID | 已闭合结论 | 证据边界 |
|---|---|---|
| `DESK-01` | PIYO/JoJo 用作无屏 OID 同类体验基准，X8 Pro 只用作反馈质量基准 | 角色分工已明确；具体时延、续航、按键和内部器件等待同 SKU 实测 |
| `DESK-02` | 首发热路径采用 `OID → 本地索引 → 本地音频 → 扬声器`，无线属于可选协调层 | 官方方案页支持架构可行性；P95、功耗与可靠性仍是益米实测目标 |
| `DESK-03` | 光头、主板、固件、码空间、码工具和印刷 profile 必须成套锁定 | 官方页面展示多种组合及相互冲突的“代”口径，单独营销名不进入 BOM |
| `DESK-04` | “四代/OID4.0”不作为工程身份 | 入场身份已经统一为 `BOARD_MPN/PCB_REV/HEAD_MPN/HEAD_REV/FW_VERSION` |
| `DESK-05` | 一体主板优先；同版候选全部失格后再启用自研 PCB 分支 | `purchase-plan.csv` 已隔离开发板拼接、随机光头和提前购买的自研板器件 |
| `DESK-06` | Rust 采用目标中立 `no_std` 核心 + 窄板级边界；OS 与 HAL 服从目标板证据 | 主机契约可以先验证；目标 triple、BSP、C compiler、链接和外设触达等待目标板 |
| `DESK-07` | 两套同 revision 样品、两只同版光头、两个独立印刷批次和 C/Rust 同向量差分构成冻结主证据 | Intake、board-port 证据包和 TestResult 路径已经定义 |
| `DESK-08` | 实物记录统一使用 `PENDING/VENDOR_DOCUMENT/OBSERVED/MEASURED` 和 artifact 引用 | 模板和机器检查入口已经存在，空白模板不会伪装成实物结果 |
| `DESK-09` | 12 个逻辑块与 18 条接口可以先冻结，具体板卡身份和物理实现留在 target binding | `HardwareSystem v1` 的 topology/binding 分离且 `402/402` 机器门保持目标 `UNRESOLVED`、EDA 为 `SYSTEM_SKELETON_ONLY` |
| `DESK-10` | 松翰当前官方 Decoder/Module 料号可用于 RFQ 交叉核对，但不等同完整 PCBA 或光学笔头 revision | `SRC-OID-004…010` 已绑定 API 请求体/响应哈希和原厂资料；库存、组合、SDK 与两套同版样品仍待供应方 |

## 3. 仍需供应商或实物关闭的部分

### 3.1 成熟产品基准

| 证据项 | 当前等级 | 关闭动作 |
|---|---|---|
| PIYO PW20 的精确 SKU、批次、固件、配套码书 | `S → PENDING` | 付款前取得包装/铭牌/配套物照片；到货后建立 REF intake |
| JoJo 32G WiFi 的精确 SKU、批次、固件、配套点读物 | `R/V → PENDING` | 同上，排除随机版本商品 |
| 两者的点到首音、断网、反馈、控制、声学和续航 | `PENDING` | 按 `benchmark-product.template.json` 的七项方法保留视频、仪器和原始记录 |
| X8 Pro 的反馈质量 | `O/V → PENDING_MEASURE` | 借用或采购精确型号后只测交互参照，不外推到无屏 OID 硬件 |

### 3.2 `BOARD_TARGET` 候选

| 证据项 | 来源类型 | 关闭动作 |
|---|---|---|
| 精确板/头/固件身份 | 供应商文件 + 实物 | 两套样品逐项一致，保存正反面、标签、serial、2D 尺寸和文件哈希 |
| 当前性与同版供货 | 供应商书面材料 | 取得 2024-2026 批次/交付证据、可供数量、PCN/EOL 和拒绝随机替代的条款 |
| OID 码空间与授权 | 供应商文件 + 工具实跑 | 封存离线码工具、版本、分配段、授权边界和至少 24 个唯一有效码 |
| 印刷 profile | 供应商文件 + 两批实物 | 固定油墨/分色/RIP/纸张/覆膜/点阵参数，执行 `2 heads × 2 print batches` |
| OID 事件与诊断 | SDK/协议 + 实板 trace | 事件、错误、sequence、drop、时间戳级别和溢出行为均可观测 |
| 本地音频与存储 | 固件表 + 实板 | 黄金音频、满盘、掉电、sync、索引提交、离线 100 次和首音测量 |
| USB/传输 | SDK/协议 + 实板 | 真实 MTU、partial read、backpressure、断连续传和重复请求副作用 |
| 电源/机械/光学 | 规格书 + 实物 | 电压电流、工作距、角度、镜头/排线包络、板轮廓和跌落后复测 |
| Rust 执行路线 | 固定工具链 + 两块实板 | 最终 C compiler layout probe、C/Rust link、同 binary 启动、外设路径和差分结果 |

因此 `board-evidence-matrix.csv` 中组创本地/智能方案与春苗本地方案继续保持 `REFERENCE_ONLY`，
`MB1-CANDIDATE-A` 继续保持 `EVIDENCE_REQUIRED/PENDING`。当前没有可据实填写的
`BOARD_TARGET`、目标 MCU、目标 OS、目标存储或目标音频器件。

## 4. `BOARD_TARGET` 冻结顺序

| Gate | 进入条件 | 通过输出 |
|---|---|---|
| `BT-0 候选入场` | 供应商交付精确身份、两套同版承诺、工具/SDK 清单、码与印刷资料、当前供货材料 | 在 matrix 建立独立 candidate，并从模板创建 intake record |
| `BT-1 来料身份` | 两套板、两只光头、固件和工具版本与付款前材料一致 | `KIT-IDENTITY` PASS；差异样品拆成不同 candidate |
| `BT-2 成熟 C 基线` | 供应商 C reference 可从封存材料构建、烧录、启动并覆盖 OID/存储/音频/USB/日志 | 固定的 source/config/tool hashes 和两板原始 trace |
| `BT-3 OID/印刷物理门` | 24 码、空白/普通印刷负样、两头、两印刷批次全部执行 | 正确率、错码、漏码、误触发、距离、角度、光照和批次原始数据 |
| `BT-4 产品数据面` | 本地索引、黄金音频、断网、首音、存储掉电、恢复和目标声学链均执行 | 对应 TestResult、音频/功率/存储原始 artifact 与哈希 |
| `BT-5 Rust/ABI` | 最终 target/C compiler/BSP 固定，platform ABI、队列、时间戳、storage、transport 与 C/Rust 差分执行 | 两块同版板的构建、map、trace、测试结果和复算清单 |
| `BT-6 供应与冻结` | 精确 revision 供货、PCN/EOL、授权、成本和交期材料齐全，全部 blocker 清空 | intake disposition=`ACCEPTED_BOARD_TARGET`，随后冻结 BOM/CAD/EDA 分支 |

## 5. 下一步最小可执行证据包

### 包 A：成熟产品到货前证据

1. 对 `REF1/REF2` 各取得一组卖家原图：包装条码、背面铭牌、完整 SKU、生产批次、
   固件/App 页面、配套码书/码卡和充电口；
2. 图片里任一版本字段含糊时保持 `READY_TO_INQUIRE`，继续询证；
3. 证据一致后各采购一台精确 SKU；
4. 到货当天从
   [`benchmark-product.template.json`](../../hardware/evt0/intake-v1/benchmark-product.template.json)
   创建唯一记录，再做七项基准，原始数据先于结论入库。

### 包 B：MB1 付款前供应商证据

先只发送 [RFQ](./gen1-p0-oid-rfq.md) 的 `M01-M08` 与以下十项最小附件要求：

1. `BOARD_MPN/PCB_REV/HEAD_MPN/HEAD_REV/FW_VERSION`；
2. 两套将要发货样品的正反面/标签/serial 照片；
3. 板与光头 2D 图、连接器和工作距；
4. MCU/BSP/RTOS/SDK/C compiler/linker 精确版本；
5. 可复现的 build/flash/log 命令与软件包 SHA-256；
6. OID 事件 API/帧协议、错误码、sequence/drop 和时间戳定义；
7. 离线码工具、版本、24 个码与空白区、码段和授权说明；
8. 印刷 profile 与两个独立印刷批次安排；
9. 音频、存储、USB、供电和离线运行能力表；
10. 当前同 revision 可供数量、批量同版条款与 PCN/EOL。

十项形成相互一致的 candidate 后再支付两套 MB1 样品款。供应商公开网页、演示视频、
“最新一代”或“兼容替代”描述只保留在来源栏。

### 包 C：到货首轮 24 小时证据

1. 先封存包裹、标签、serial、板/头六面照片、随附文件及哈希；
2. 对照付款前材料执行 `KIT-IDENTITY`，身份差异立即隔离；
3. 限流上电，记录 rail、idle/peak 和异常复位；
4. 原样运行供应商 C reference，保留完整 build/flash/boot/log；
5. 在改动 SDK、改动 PCB 或写 Rust port 之前，先完成 24 码、空白负样和完全离线基线；
6. 将记录写入 `hardware/evt0/intake-v1/records/`，后续所有 Rust 与产品测试引用同一 candidate ID。

这个三包顺序把下一笔费用绑定到可核验增量：先确认 SKU/kit 身份，再买样，先建立
C/物理基线，再进入 Rust target port。

## 6. 本轮收紧的机器证据门

[`validate-evt0-intake.mjs`](../../scripts/validate-evt0-intake.mjs) 已在本轮完成以下修正：

1. `physicalEvidenceComplete` 只接受 `purchasePlanItemId=MB1`、
   `disposition.status=ACCEPTED_BOARD_TARGET`、两套同版样品、关键观察全关闭、测试证据齐全且
   blocker 为零的记录；文件名不再决定完成态；
2. Intake 文件实际执行 Draft 2020-12 JSON Schema 校验；
3. `PASS` 必须同时包含结构化 `result` 和至少一个 raw artifact 引用，
   `NOT_APPLICABLE` 必须记录具体理由；
4. 验证器内置 `PENDING MB1` 负向回归，防止空白模板触发 `BOARD_TARGET` 完成态。

本轮结果为 `207/207`、物理记录 `0`、`physicalEvidenceComplete=false`。因此这里的通过只证明
模板和门逻辑有效，没有把实物证据状态提前。

## 7. 文档发送门

[OID/主板 RFQ](./gen1-p0-oid-rfq.md) 已区分当前预询证与后续批量用途：项目摘要保持
“正在开发、处于证据冻结与候选筛选阶段”，现阶段只发送 `M01-M08 + 包 B`；同版批量、
授权和第二来源条款留到真实 EVT-0 通过并能引用实际报告路径后启用。

## 8. 每个工作包完成后的双线收益复排

固定尺度为：关键路径 30、证据就绪 20、接近实物闭环 20、复用累积 10、时间/成本 10、
低返工 10。评分只解释当前顺序，不替代证据门，也不强制硬件/软件轮换。

### 8.1 已收口工作

- `HW-HARDWARE-SYSTEM-01`：12块/18接口拓扑、target binding 与 EDA 准入门完成；
- `HW-MB1-PREPAY-01`：两家完整 PCBA/OID 候选发送包完成，状态为 `READY_TO_SEND`；
- `SW-FAMILY-CONSUMER-01`：companion 首个产品消费者完成，repository→live fixture
  authorization→design Snapshot 调用链由17项 gate、10个资产和6项零输出副作用负例关闭；
- `SW-FAMILY-ASSET-EXPORT-01`：RepositoryBackup、全部历史资产、内容寻址 manifest、精确目录闭包、
  资源门与 distinct-replica portable restore 完成；26项 companion gate、6项授权负例、6项导出负例通过；
- `SW-REAL-PRELISTEN-01`：canonical import、完整 decode、稳定 AudioPlayer port、app-local `ffplay`
natural-end adapter、严格 presentation controller 和显式确认入口完成；确定性19/19、主机进程生命周期16/16，固定工具链主机
probe 为10/10 callback，provider/proof/BuildAuthorization 闭环通过；人员听觉、麦克风实录和目标音频保持开放；
- 成熟产品账号/录音/离线一手核验新增 `SRC-FAM-001…007`，识别出 repository-only backup
  不含资产字节的具体缺口。

### 8.2 `SW-FAMILY-CONSUMER-01` 后复排（历史选择）

分项按 `关键路径/证据/实物/复用/成本/低返工` 记录，避免只给总分：

| 候选工作包 | 分项 | 总分 | 可执行状态与判断 |
|---|---|---:|---|
| `HW-MB1-SEND-AND-FREEZE`：发送询证、核回件、采购两套同版 kit | `30/18/20/10/7/9` | **94** | 全局最高；发送/回复/付款涉及外部联系与用户采购动作 |
| 竞品精确 SKU 购买与到货 intake | `20/18/20/8/7/9` | **82** | 实物体验收益高；付款和物流到货前没有新的本地测量数据 |
| `SW-FAMILY-ASSET-EXPORT-01`：asset vault + 完整家庭包导出/干净恢复 | `22/18/10/10/9/9` | **78** | 当前完全本地可执行的最高项；直接关闭官方成熟产品交叉核验发现的数据缺口 |
| `SW-REAL-PRELISTEN-01`：真实播放 callback 与确认 UI | `18/14/12/9/8/8` | **69** | 产品价值高；需先明确本地 asset 生命周期，UI/runtime 选择仍待证 |
| 嘉立创EDA系统骨架落图 | `15/16/6/8/8/4` | **57** | 逻辑骨架已有机器合同；目标板身份未冻结时芯片级落图返工风险仍高 |
| 生产 authority/keyring/replay adapter | `18/10/8/9/6/5` | **56** | 生产必需；OS keystore、账号来源和 runtime 尚未冻结 |
| 定制 PCB 芯片级设计 | `10/4/4/4/5/2` | **29** | 一体板分支尚未失格，接口证据不足 |

当时的执行结论分成两条：

1. **外部动作最高收益：** 按 [`gen1-mb1-prepay-pack.md`](./gen1-mb1-prepay-pack.md)
   发送同一询证包；收到回件即暂停低分本地工作并重新评分；
2. **当前本地动作最高收益：** 执行 `SW-FAMILY-ASSET-EXPORT-01`，使用现有 FamilyRepository
   backup 加全部引用资产、规范 manifest 和逐文件 SHA-256，证明干净目录恢复后的
   revision/asset/preview 等价；仍不引入 SQLite、云账号或第二条编译管线。

### 8.3 `SW-FAMILY-ASSET-EXPORT-01` 后复排（历史选择）

完整导出包已关闭以下主机缺口：所有历史资产引用闭包、`path == sha256`、精确目录内容、显式
资源策略、同 assetId 历史换字节、干净恢复 revision/asset/preview 等价，以及源/恢复 outbox
cursor 隔离。异常退出 staging 回收、父目录 fsync 和真实介质耐久仍保持独立门。

| 候选工作包 | 分项 | 总分 | 可执行状态与判断 |
|---|---|---:|---|
| `HW-MB1-SEND-AND-FREEZE`：发送询证、核回件、采购两套同版 kit | `30/18/20/10/7/9` | **94** | 全局最高；同时解锁芯片级 EDA、Rust target/BSP、OID、音频、存储、电源、结构和 HIL；涉及外部联系、回件和付款 |
| 竞品精确 SKU 购买与到货 intake | `20/18/20/8/7/9` | **82** | 建立成熟产品实物体验基线；依赖卖家原图、采购与物流，且本身不冻结 BOARD_TARGET |
| `SW-REAL-PRELISTEN-01`：真实录音/导入、实际播放 callback、显式确认 UI | `20/17/13/9/8/9` | **76** | 当前本地最高；资产生命周期与恢复边界已明确，可复用 repository、vault、preview 与 Confirmation Trust；UI/runtime 尚未冻结 |
| 嘉立创EDA系统骨架落图 | `15/16/6/8/8/4` | **57** | 逻辑骨架已有机器合同；目标板身份未冻结时芯片级落图返工风险仍高 |
| 生产 authority/keyring/replay qualification adapter | `18/10/8/9/6/5` | **56** | 生产必需；真实账号来源、App runtime、OS keystore 和产品事务存储仍待证 |
| 定制 PCB 芯片级设计 | `10/4/4/4/5/2` | **29** | 一体板分支尚未失格，接口证据仍不足 |

当前执行结论：

1. **外部最高收益：** 发送同一 MB1 询证包；任何供应商回件到达都立即触发重排；
2. **供应商等待窗内本地最高收益：** `SW-REAL-PRELISTEN-01`，范围固定在 companion 组合根内的
   本地录音/导入 adapter、真实播放完成 callback 和显式确认，不提前选择共享 UI/runtime 大框架；
3. 两套同 revision kit 到货后，`KIT-IDENTITY + 24小时来料基线`直接重新竞争全局第一。

任一包完成或新外部证据到达后，继续重算本节，而不是沿当前表惯性推进。

### 8.4 `SW-REAL-PRELISTEN-01` 后复排（当前）

本包新增的是可复用接缝，不是生产完成声明：真实文件先进入内容寻址 vault；preview 播放前重新复算
bytes/hash；scripted backend 关闭确定性负例；固定 SHA-256 的 ffprobe/ffmpeg/ffplay 分别证明 profile、
完整解码和主机播放器自然退出；显式动作随后经既有 Confirmation Trust 派生 BuildAuthorization。
本次自动主机 run 没有人员听觉见证、麦克风采集、目标板或声学回采。

| 候选工作包 | 分项 | 总分 | 可执行状态与判断 |
|---|---|---:|---|
| `HW-MB1-SEND-AND-FREEZE`：发送询证、核回件、采购两套同版 kit | `30/18/20/10/7/9` | **94** | 全局最高；仍是 BOARD_TARGET、真实OID、Rust BSP、芯片级EDA、目标音频和HIL的共同解锁点；需要外部联系、回件和付款 |
| 竞品精确 SKU 购买与到货 intake | `20/18/20/8/7/9` | **82** | 成熟产品实物体验基线；需要卖家原图、采购和物流，且不单独冻结 BOARD_TARGET |
| `SW-FAMILY-AUTHORING-01`：真实资产→FamilyRevision→CAS→BuildPlan→preview→真实预听 | `21/18/12/10/8/8` | **77** | 当前本地最高；直接复用刚完成的 import/vault/prelisten 和既有 repository/build 合同，关闭 golden revision 仍是入口的缺口，不冻结 UI/runtime |
| `HW-LAB-BASELINE`（吸收原 `HW-EVT0-BENCH-PREP-01`）：仪器/耗材校验、证据目录、量测方法和通用台架演练 | `20/18/16/9/7/6` | **76** | 让到货件立即可测并复用到后续板卡/HIL；具体连接器、供电 rail、光头和板级测点仍随 MB1 revision 冻结 |
| 嘉立创EDA系统骨架落图 | `15/16/6/8/8/4` | **57** | 逻辑骨架已冻结；目标板身份未定时，芯片级原理图、封装和PCB仍有高返工 |
| 生产 authority/keyring/replay qualification adapter | `18/10/8/9/6/5` | **56** | 生产必需；真实账号来源、OS keystore、产品事务存储和运行时尚未冻结 |
| 定制 PCB 芯片级设计 | `10/4/4/4/5/2` | **29** | 一体板路线尚未失格，具体 MCU/OID/codec/电源/结构证据不足 |

当前执行结论：

1. **外部第一动作仍为94分 MB1 询证/冻结。** 任一回件、新附件或付款条件变化都会立刻触发重排；
2. **外部等待窗内，本地第一动作转为77分 `SW-FAMILY-AUTHORING-01`。** 只建立真实资产到目标中立
   revision 的用例和现有合同接线；保持 App-local，不引入共享 UI framework、SQLite 或账号体系；
3. **硬件本地候选为76分 `HW-LAB-BASELINE`。** 它持续与软件候选比较，但具体电气夹具等待同版 kit 身份，
   防止先画 connector/rail 后返工；
4. 实际麦克风录音可用显式设备名执行单列 probe；在用户启动采集前不把环境声音写入证据包。

下一包收口后再次从完整候选池评分，不自动沿软件线继续。
