# 益米 Gen1 产品系统证据台账

> 状态：活文档 v0.1  
> 首次核验：2026-08-03  
> 用途：给产品切片、目标主板/OID、Snapshot 和后续 EDA/固件决策提供可追溯依据。机器可读来源见 [`hardware/evt0/evidence-sources.json`](../../hardware/evt0/evidence-sources.json)。

## 1. 证据等级

沿用成熟产品调研的等级，增加实测级 `M`：

| 等级 | 含义 | 允许的结论 |
|---|---|---|
| `O` | 品牌、芯片原厂或方案商官方页面/数据手册 | 可记录其公开内容；方案商营销参数仍需样品复核 |
| `M` | 本项目对精确型号/revision 的实物测量 | 可进入对应 revision 的工程基线 |
| `R` | 当前零售页/卖家资料 | 证明某 SKU/卖法存在；料号、内部架构和性能仍待实测 |
| `S` | 可追溯二手资料或百科汇总 | 形成采购与测试假设 |
| `V` | 从图片、铭牌、视频直接观察 | 只记录可见状态，不推断内部实现 |
| `E` | 益米工程目标/设计决策 | 进入需求和验收，不能反写成竞品事实 |
| `I` | 从多条证据得出的工程推论 | 必须同时写出推论和验证门 |

## 2. 本轮来源

| ID | 等级 | 来源 | 本轮状态 | 可用范围 |
|---|---|---|---|---|
| `SRC-OID-001` | `O` | [组创点读笔方案](https://www.ztrontech.com/solutions/1.html) | HTTP 200，已记录 SHA-256 | OID/存储/MCU/音频的公开方案架构；不代表可采购精确板 |
| `SRC-OID-002` | `O` | [组创 WiFi 点读笔方案](https://www.ztrontech.com/educational1/118.html) | HTTP 200，已记录 SHA-256 | 无线、App 和云属于扩展层的方案商公开描述 |
| `SRC-OID-003` | `O` | [组创蓝牙/WiFi OID方案对比](https://www.ztrontech.com/educational1/119.html) | HTTP 200，已记录 SHA-256 | 多档硬件组合和码容量宣称；全部保留样品/工具复核门 |
| `SRC-OID-004/005` | `O` | [松翰 OID 分类 API](https://www.sonix.com.tw/products/oid) | 官方 POST 响应已记录请求体、字节数和 SHA-256 | 证明 Decoder/Sensor Module 当前目录分类与更新时间；不表示库存 |
| `SRC-OID-006/007` | `O` | [松翰 OID 产品目录](https://www.sonix.com.tw/products/oid) | 官方 POST 响应分别列出 3 个 Decoder 与 8 个 Sensor Module 家族 | 形成准确 RFQ 短名单；不等同完整板卡/笔头 revision |
| `SRC-OID-008` | `O` | [SN953x0 Datasheet V1.5](https://www.sonix.com.tw/webapi/fl200024/SN953x0_DS_V1.5.pdf) | HTTP 200，已记录 1,644,093 字节与 SHA-256 | Decoder 架构与外设参考；目标实现需板级复核 |
| `SRC-OID-009/010` | `O` | [2100A 模组资料](https://www.sonix.com.tw/webapi/fl219813/SNM9S5x30(B)C2100A_DS_V1.1.pdf)、[2-wire 接口手册](https://www.sonix.com.tw/webapi/fl218298/SNM9S53xx_54xx_2-wire_Int_Manual_V1.3.pdf) | HTTP 200，均已记录字节数和 SHA-256 | `SNM9S5430/5630BC2100A` 与接口的 RFQ/适配依据；仍需精确样品和 trace |
| `SRC-OID-011` | `O` | [春苗点读笔技术方案](https://www.szdianjiao.com/articles/readpen.html) | HTTP 200，已记录 8,635 字节与 SHA-256 | 第二家完整 PCBA/OID 询证入口；SDK、工具和存储均为供应方公开描述 |
| `SRC-FAM-001/002` | `O` | [tiptoi Manager](https://www.ravensburger.de/de-DE/entdecken/tiptoi/tiptoi-manager)、[tiptoi 音频下载](https://www.ravensburger.de/de-DE/entdecken/tiptoi/tiptoi-audiodateien) | HTTP 200，已记录原始响应字节和 SHA-256 | 桌面内容管理、USB/文件装载与离线产品流程参考；账号行为仍以实物观察为准 |
| `SRC-FAM-003` | `O` | [LeapFrog Connect](https://www.leapfrog.com/en-us/support/connect) | HTTP 200，已记录 142,654 字节和 SHA-256 | Parent Account 注册与厂商内容下载边界参考 |
| `SRC-FAM-004…006` | `O` | [Yoto Family Accounts](https://support.yotoplay.com/en_gb/family-accounts-HJq3OKomzx)、[自有录音](https://support.yotoplay.com/en_gb/how-to-create-a-playlist-from-your-own-recordings-B1piuFiXGl)、[离线容量](https://support.yotoplay.com/en_gb/how-much-content-can-my-yoto-store-for-offline-listening-SJNFKiQGe) | HTTP 200，三份响应均已记录字节和 SHA-256 | 家庭成员/多设备、录音回听、云库与设备离线缓存分层参考；Yoto 不是 OID 点读笔 |
| `SRC-FAM-007` | `O` | [Yoto 隐私政策](https://yotoplay.com/legal/privacy-policy) | HTTP 200，已记录 405,119 字节和 SHA-256 | 云账号与用户录音处理边界；不等同用户持有的完整本地备份 |
| `SRC-XF-001` | `O/V` | [讯飞商城 X8 Pro 商品页](https://www.xunfei.cn/goods?goodsId=2223) | HTTP 200，详情以图片呈现 | 仅证明当前商品页和交互参照存在；不作为点读硬件架构基线 |
| `SRC-ESP-001` | `O` | [ESP32-S3-MINI-1/1U 数据手册](https://www.espressif.com/sites/default/files/documentation/esp32-s3-mini-1_mini-1u_datasheet_en.pdf) | HTTP 200，已记录 SHA-256 | 自研分支候选器件资料，不表示该分支已经入场 |
| `SRC-TI-001` | `O` | [BQ24074 数据手册](https://www.ti.com/lit/ds/symlink/bq24074.pdf) | HTTP 200，已记录 SHA-256 | 自研电源分支候选资料，不表示 BOM 已冻结 |
| `SRC-STD-001` | `O` | [RFC 8785 JSON Canonicalization](https://www.rfc-editor.org/rfc/rfc8785) | HTTP 200，已记录 SHA-256 | Snapshot发布 ID 的确定性 JSON 规范化依据 |
| `SRC-STD-002` | `O` | [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/schema) | HTTP 200，已记录 SHA-256 | Snapshot manifest 的结构约束基线 |
| `SRC-PIYO-001` | `S` | 仓库既有 PIYO PEN PW20 汇总来源 | 本轮直连返回 403 | 继续作为采购假设；只在实物铭牌和测量后升级为 `M` |
| `SRC-JOJO-001` | `R/V` | 仓库既有 JoJo 32G WiFi 零售来源 | 本轮直连返回 405 | 继续作为购买与交互观察入口；不用于内部器件结论 |

网页下载缓存位于忽略提交的 `build/evidence-cache/`；仓库保存 URL、访问结果、字节数和哈希，不保存整页副本。

## 3. 已有依据支持的结论

### 3.1 点读的基础数据面应保持本地

`SRC-OID-001` 把基础链路描述为 OID 光学输入、MCU/算法、预存声音文件和扬声器；同时列出本地 Flash/TF 与 USB。它支持“点读热路径本地完成”作为可行成熟架构。益米进一步要求 P95 `<200ms` 和断网可用，这是 `E` 级产品目标，仍需在精确主板上测量。

**决策：** 正常 `OID → 索引 → 本地音频 → 扬声器` 保持在设备内；无线只进入内容管理与可选服务。

### 3.2 真实 OID、光头、码工具与印刷必须成套锁定

`SRC-OID-001` 明确把 OID、红外感光、算法和特殊印刷材料视为同一识别链。`SRC-OID-003` 又展示多种光头/主控/存储组合，并给出不同码容量宣称。这说明“第四代”“通用光头”之类营销词不足以冻结工程版本。

**决策：** `BOARD_MPN / PCB_REV / HEAD_MPN / HEAD_REV / FW_VERSION / CODE_TOOL / PRINT_PROFILE` 同时进入证据门；码容量宣称在目标工具生成、两只光头和两批印刷实测前保持 `VENDOR_CLAIM`。

### 3.3 无线是产品能力分支，不是点读前置条件

`SRC-OID-002/003` 把 WiFi、蓝牙、App、云资源和在线交互描述为智能方案的扩展能力，同时公开列出传统本地存储方案。

**工程推论 `I`：** 益米采用设备数据面 + 家庭协调层的分工与成熟方案族兼容。最终是否具备 BLE/WiFi、吞吐量和配对方式，等待 `BOARD_TARGET` 能力表；USB 先作为大包基线。

### 3.4 原厂准确料号只缩小 RFQ 范围

`SRC-OID-004…010` 把松翰公开范围从“Sonix 三代/95500”收窄到当前目录中的
`SN95310/350/360` Decoder、`SNM9S5X30BC2100A` 模组家族、资料中的
`SNM9S5430BC2100A / SNM9S5630BC2100A` 具体变体和 2-wire 接口。它们分别属于
解码器与 Sensor Module，官方公开材料尚未给出一个“具体 Decoder + 具体 Module +
具体 PCBA”的已验证组合及订货状态。

**决策：** 这些料号进入供应商询证短名单，不直接写入 `BOARD_TARGET`、`HEAD_REV`
或量产 BOM。`SN95500` 在本轮当前目录未检得，只记为缺少当前目录交叉确认。

### 3.5 一体板公开架构不等于可生产目标板

组创与春苗公开页面能证明市场存在本地存储、OID、工具/SDK 与 PCBA 服务方案，却没有公开精确 PCBA 型号、revision、尺寸、完整原理图、SDK/CLI、日志接口、固件版本映射和当前同版供货。

**决策：** 这些组合只进入 `REFERENCE_ONLY` 行。供应商给出精确身份和样品证据后，才创建 `BOARD_TARGET_CANDIDATE`。

### 3.6 竞品体验必须通过同 SKU 实物基准建立

PIYO 与 JoJo 的现有资料分别为 `S` 和 `R/V`，且网页刷新受限；讯飞 X8 Pro 是官方当前页面，但它属于带屏词典笔，只用于失败反馈和交互质量参照。

**决策：** 到货后先封存包装、铭牌、固件、配套码书和内容版本，再测开箱、按键、灯语、未绑定、低电、升级、首音、离线和重复点击。未到货前不填竞品精确时延、续航、内部器件或协议。

### 3.7 家庭账号、回听、云库与离线执行应解耦

`SRC-FAM-001/002` 展示桌面文件/设备内容管理路线，`SRC-FAM-003` 把 Parent Account 放入
厂商内容注册流程，`SRC-FAM-004…006` 则展示家庭成员、App 录音回听、云内容库与设备离线缓存。
这些成熟产品的实现不同，说明账号主要承载内容权益、共享与同步，不是 OID、本地确认、USB 装载
和已装内容离线执行的统一领域身份。

`SRC-FAM-007` 进一步说明云端录音处理有自己的保存和删除边界。因此 repository state 备份不能
冒充完整家庭资产备份；益米的本地导出需同时携带全部引用资产、逐文件哈希和干净恢复证明。

**决策：** FamilyRevision 保持账号无关；账号以后通过 `authorityResolver` 和同步 adapter 接入。
首个 companion host 先关闭 repository→authorization→design Snapshot 调用链；真实播放 callback
与完整家庭资产导出作为后续独立 acceptance，不由夹具 transcript 或 repository-only backup 替代。

## 4. 仍待证据回答的问题

| 问题 | 当前状态 | 关闭证据门 |
|---|---|---|
| 当前可采购的一体主板精确身份 | `BLOCKED` | 两套同 `BOARD_MPN/PCB_REV/HEAD_MPN/HEAD_REV/FW_VERSION` 的实物与资料 |
| 光头事件接口和时间戳 | `BLOCKED` | SDK/API/帧协议或可同步测量的测试点 |
| OID 码空间与印刷工具 | `BLOCKED` | 可离线运行的码生成器、版本、24码卡和印刷工艺 |
| WAV/MP3 精确支持边界 | `BLOCKED` | 目标固件支持表 + 黄金音频逐项播放 |
| 32GB 存储介质和掉电行为 | `BLOCKED` | 精确 MPN、满盘、断电和三轮 500MB 安装测试 |
| BLE/WiFi 是否进入 Gen1 | `OPEN` | 目标板能力、功耗、装包吞吐和用户旅程收益 |
| OpenVela 是否采用 | `OPEN` | `BOARD_TARGET` SoC/BSP、音频/OID/USB/升级和量产工具评审 |
| 竞品真实体验基线 | `READY_TO_MEASURE` | `REF1–REF4` 对应实物的同 SKU 测试记录 |
| 家庭录音真实回听 | `DESIGN_READY` | 产品播放 callback 生成逐 clip transcript，并覆盖中断/重播/确认门 |
| 完整家庭导出/恢复 | `DESIGN_READY` | RepositoryBackup + 全部引用资产 + manifest；干净目录恢复后 revision/asset/preview 等价 |

## 5. 证据纪律

1. 官方/方案商公开内容写成“公开描述/宣称”，不自动升级成量产保证；
2. 零售标题和详情图只证明可见 SKU 与界面；
3. 只有精确型号/revision 的实物测量可以把关键硬件字段升级为 `M`；
4. 益米目标始终标 `E`，工程推论始终标 `I`；
5. 每个 `BLOCKED/OPEN` 项必须有关闭它的具体交付物或测试；
6. 新证据改变路线时，先更新证据台账和任务边界，再改设计。
