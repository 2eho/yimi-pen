# 下一工作包收益排序（2026-08-04）

## 目的

每个工作包收口后，同时比较硬件线和软件/系统线的候选项，再选择当前预期收益最高的一项。比较是动态的，不按“硬件/软件轮换”或旧清单顺序推进。

本文按时间保留硬件/软件范围切换的历史快照；当前执行边界以两个active anchor为准：硬件线与软件线隔离写入、
同步读取，各线程只从自己的候选池落地，并把另一线的已验证变化作为接口与收益排序输入。

## 评分方法

总分 100，分项权重固定如下：

| 维度 | 权重 | 判定依据 |
| --- | ---: | --- |
| 关键路径解锁 | 30 | 是否解除 `BOARD_TARGET`、OID 头、接口或验收门 |
| 证据就绪度 | 20 | 是否已有一手资料、可复算哈希或可获得实物证据 |
| 实物闭环距离 | 20 | 是否直接推进采购、到货、测量或 HIL |
| 复用累积收益 | 10 | 后续板卡、固件、EDA、验收能否重复使用 |
| 时间/成本 | 10 | 当前投入与反馈周期 |
| 返工风险 | 10 | 结果是否可能因未知板号/接口而推倒重来 |

## `HW-EDA-BRIDGE-01` 收口证据

- `npm run refresh:hardware-evidence`：11/11 个锁定官方 OID 源状态、字节数和 SHA-256 一致。
- `npm run eda:doctor`：JLCEDA 可执行文件、Node `v24.18.1`、MCP `0.35.4`、只读 scope、loopback listener、连接证据全部通过；`No external listener` 通过。
- 报告：`build/hardware-evidence-refresh.json`、`build/jlceda-bridge-status.json`。
- 结论：嘉立创EDA准入层已经具备只读检查条件，但这不代表目标主板、OID头或芯片级设计已冻结。
- 运行态补充：当前 Codex 内置 MCP 探针返回 `active_port=49629 / bridge_connected=false`，而 doctor 观察到 `49620` 上已有另一份同包 MCP 进程与 JLCEDA 建立 2 个 loopback endpoint。两份进程造成端口扫描分流；这是运行态单例问题，不能把它误写成 EDA 工程或主板证据。后续用 `HW-EDA-SINGLETON-REPAIR` 收口后，再把 live MCP 读取结果纳入证据。
- `HW-EDA-SINGLETON-INSPECT-01` 已完成：`npm run eda:singleton` 记录到 10 个同包 MCP 进程分别监听 `49620–49629`，只有 `49620` 与 JLCEDA 建立连接；报告为 `singleton=false`。这一步收集了可复算的运行态证据，修复动作仍单独保留。

## `HW-EDA-BRIDGE-01` 后第一次复排（历史快照）

| 排名 | 工作包 | 线别 | 分数 | 选择理由 | 当前动作 |
| ---: | --- | --- | ---: | --- | --- |
| 1 | `HW-MB1-SEND-AND-FREEZE` | 硬件/外部 | 94 | 直接解除板号/OID头/接口证据门，决定后续 EDA 是否进入芯片级 | 发送 `docs/research/gen1-mb1-prepay-pack.md`，等待结构化回件 |
| 2 | exact benchmark SKU purchase/intake | 硬件/外部 | 82 | 建立成熟点读笔实物、光学、声学和结构基准 | 按 `hardware/evt0/purchase-plan.csv` 单买并记录 intake |
| 3 | `HW-LAB-BASELINE` | 硬件/本地 | 76 | 让到货件立即可测，复用到所有后续板卡与 HIL | 固化仪器/耗材清单、校验记录与通用台架演练 |
| 4 | `HW-EDA-SINGLETON-REPAIR` | 硬件/本地 | 64 | 归一 live MCP 运行态，但不解除板号、OID 或 HIL 门 | 仅在后续包依赖 live JLCEDA 时作为运行前置门 |
| 5 | `HW-EDA-SKELETON` | 硬件/本地 | 57 | 可提前复用层级和接口标签，但不能填真实芯片/引脚/电源值 | 仅保留 block/hierarchy/interface labels |
| 6 | `SW-REAL-PRELISTEN-01` | 软件/本地 | 42 | 当时对硬件关键路径解锁较小，且硬件工作单元范围冻结 | 历史候选；后来由隔离系统线完成 |

`HW-EDA-SINGLETON-REPAIR` 按 `16/18/5/9/9/7=64` 计分：10个进程与端口分流已有可复算证据，但它只解锁可靠 live EDA 读取，不产生实物证据，也不解除 `BOARD_TARGET`、OID头、采购或HIL门。因此它低于实验室基线；若某个后续包直接依赖 live JLCEDA，则把它作为该包的运行前置门处理。

## 选择结果

本包完成后下一动作选择第 1 项：发送 MB1 证据询证包。原因是它的关键路径解锁和物理闭环收益显著高于继续画自研 PCB；在 `BOARD_TARGET=UNRESOLVED` 时，芯片级原理图、引脚映射、供电值、连接器和 PCB 布局都保持锁定。

供应商等待期间，任一包完成或出现新回件、实物、测量、EDA状态变化都会触发复排；硬件工作单元当前先取本地 `HW-LAB-BASELINE`。

## 并行系统线新证据与再次复排

随后隔离完成 `SW-REAL-PRELISTEN-01`，因此上表的42分待办行已被实际证据取代：

- canonical WAV 进入内容寻址 vault，发布后重新复算 profile/bytes/SHA-256；
- 确定性门19/19，覆盖提前确认、错误、timeout、abort、显式 stop、缺 receipt、重复/陈旧 callback、资产篡改、解析期取消和并发播放；
- 主机进程生命周期门16/16，覆盖 `close` 结算、终止升级、错误后无重叠重试及录音 staging/独占发布；
- 固定 SHA-256 的 ffprobe/ffmpeg/ffplay 对10个 preview clip 完成 profile、完整 decode 和10/10
  natural-end callback；
- 显式 runner 动作随后经既有 provider 验证并派生 BuildAuthorization；
- 报告仍将人员听觉、麦克风实录、目标板音频和声学回采标为未覆盖。

按同一权重再次比较完整候选池：

| 排名 | 工作包 | 线别 | 分项 | 总分 | 当前判断 |
| ---: | --- | --- | --- | ---: | --- |
| 1 | `HW-MB1-SEND-AND-FREEZE` | 硬件/外部 | `30/18/20/10/7/9` | **94** | 全局第一；任一回件立即重排 |
| 2 | exact benchmark SKU purchase/intake | 硬件/外部 | `20/18/20/8/7/9` | **82** | 依赖卖家原图、采购和物流 |
| 3 | `SW-FAMILY-AUTHORING-01` | 软件/本地 | `21/18/12/10/8/8` | **77** | 将真实资产写入 target-neutral FamilyRevision，经 CAS 后复用 BuildPlan→preview→真实预听；不冻结 UI/runtime |
| 4 | `HW-LAB-BASELINE` | 硬件/本地 | `20/18/16/9/7/6` | **76** | 让到货件立即可测；具体 connector/rail 仍等同版 kit |
| 5 | `HW-EDA-SINGLETON-REPAIR` | 硬件/本地 | `16/18/5/9/9/7` | **64** | 修复10进程/端口分流；只在下一包依赖 live JLCEDA 时前置 |
| 6 | `HW-EDA-SKELETON` | 硬件/本地 | `15/16/6/8/8/4` | **57** | 仅层级/接口标签，芯片级内容继续锁定 |
| 7 | production authority/keyring/replay qualification | 软件/本地 | `18/10/8/9/6/5` | **56** | 真实账号、OS keystore 和产品事务存储尚未冻结 |

该表保留当时的跨线比较证据。2026-08-04 最新范围只执行软件，因此当前执行过滤器选择77分
`SW-FAMILY-AUTHORING-01`；94分 MB1、82分实物采购和其余硬件项仅作为外部依赖状态保留，
不从本软件任务发起。每个软件包收口后仍按同一维度在软件候选池重算，不按固定清单推进。

## 硬件路线恢复与本轮收口后的复排

用户已重新明确当前只执行硬件，所以上一节的软件过滤器成为历史快照。本轮新增或复核的证据：

- 三份互斥范围审计：采购/供应商、复用/维护、验证/EDA；
- `HW-LAB-BASELINE`：9 methods、6 instrument slots、132/132；实际仪器登记仍为空；
- `HW-MB1-VENDOR-EVIDENCE-V1`：`M01–M08`、`A01–A10`、五元组、两件待发样品和付款门，18/18；response records为0；
- `HW-BOM-REVISION-V1`：修复 `J1`/`SD1` 漂移，增加分支适用性、CSV/binding hash、证据selector、receipt与审批，86/86；`BOM-REV-A`仍为PENDING；
- HardwareSystem 402/402、intake 207/207且实物记录0、hardware test 1/1；
- EDA doctor全部PASS，但singleton仍为10进程/10监听，仅49620连接。

### 当前候选

| 排名 | 工作包 | 分项 | 总分 | 当前动作 |
|---:|---|---|---:|---|
| 1 | `HW-MB1-SEND-AND-FREEZE` | `30/18/20/10/7/9` | **94** | 通过真实供应商渠道发送统一询证；回件进入 `vendor-evidence-v1`，付款后两套实物进入intake |
| 2 | exact benchmark SKU purchase/intake | `20/18/20/8/7/9` | **82** | 取得卖家原图和精确SKU后单买，建立成熟产品光学/声学/结构基准 |
| 3 | `HW-INTAKE-SAMPLE-IDENTITY-V2` | `22/20/5/10/9/10` | **76** | 强制每件样品独立五元组、serial/lot和artifact manifest，并补齐binding影响映射 |
| 4 | `HW-LAB-INSTRUMENT-REGISTRATION` | `18/16/14/9/9/9` | **75** | 用户盘点实际LAB1–LAB6后登记型号、serial和校准/自检；缺项再采购 |
| 5 | `HW-EDA-SINGLETON-REPAIR` | `16/18/5/9/9/7` | **64** | 仅在下一包依赖live JLCEDA时前置；保护其他Codex会话 |
| 6 | `HW-EDA-SKELETON` | `15/16/6/8/8/4` | **57** | 仅层级、块图和接口标签，芯片级内容继续锁定 |
| 7 | 芯片级自研PCB | `10/4/4/4/5/2` | **29** | 一体主板分支尚未失格，保持锁定 |

### 选择

全局下一动作仍为94分的 `HW-MB1-SEND-AND-FREEZE`，它需要真实外发渠道。等待外部动作时，
当前最高收益的本地包是76分 `HW-INTAKE-SAMPLE-IDENTITY-V2`；它只加强证据模型，不填写板号、
引脚、电压或器件猜测。任一供应商回件、卖家原图、采购、到货或仪器盘点都会立即触发复排。

## `HW-INTAKE-SAMPLE-IDENTITY-V2` 收口后的当前排序

该包已完成：每件board/OID样品都需独立五元组、唯一serial、lot和带bytes/SHA-256的artifact
manifest；混revision、重复serial、缺artifact与仅修改状态的伪通过均有负向门。target binding
同时实现全部board-kit observation/test的影响归属，结果为intake 216/216、HardwareSystem 425/425。

| 排名 | 工作包 | 总分 | 状态 |
|---:|---|---:|---|
| 1 | `HW-MB1-SEND-AND-FREEZE` | **94** | 需要真实外发渠道；当前最高收益动作 |
| 2 | exact benchmark SKU purchase/intake | **82** | 需要卖家原图、实际下单和到货 |
| 3 | `HW-LAB-INSTRUMENT-REGISTRATION` | **75** | 需要盘点实际仪器型号、serial和校准/自检证据 |
| 4 | `HW-EDA-SINGLETON-REPAIR` | **64** | 仅在live JLCEDA读取成为下一包前置时执行 |
| 5 | `HW-EDA-SKELETON` | **57** | 系统骨架已足够；芯片级仍锁定 |
| 6 | 芯片级自研PCB | **29** | 一体主板分支尚未失格 |

当前不存在比前三项更高收益、且不依赖外部事实的本地设计动作。继续添加芯片/电源/连接器细节会
越过证据门；因此下一次复排触发器是供应商回件、精确SKU证据、实物到货或仪器盘点，而不是
继续扩展猜测性EDA。

## 并行软件任务：Family Authoring 01A 收口后复排

本节只约束显式 software-only 任务，不改变上一节独立硬件线程的动作。新增可复算证据：

- `SW-FAMILY-AUTHORING-01A` 为15/15：真实 golden WAV → content-addressed import receipt →
  target-neutral FamilyRevision → CAS/replay → BuildPlan → materialized preview → 10/10注入式 natural-end；
- authored revision 不含 `contentPath/absolutePath/codec/durationMs`；陈旧头、缺 binding/clip 和坏 receipt
  均保持 repository state hash 不变；
- pinned ffplay 10/10、Confirmation Trust 17/17、静态 revision 的 authorized design compile 已分别成立，
  所以下一步缺口是复用这些端口组成同一 authored 调用链，而不是新增 Schema 或播放器。

当前软件候选按同一 `30/20/20/10/10/10` 工程优先级尺度复算；“闭环”在本线程指可验证软件产品闭环，
物理/生产证据仍由 ReleaseGate 保持 missing：

| 排名 | 软件工作包 | 分项 | 总分 | 证据判断 |
| ---: | --- | --- | ---: | --- |
| 1 | `SW-FAMILY-AUTHORING-01B`：authored preview → pinned ffplay → 显式确认 → provider/BuildAuthorization → authorized design Snapshot | `22/20/16/10/8/9` | **85** | 所有稳定端口已分别通过；连接后直接关闭首个家庭创作软件切片，且不锁定UI/账号/板卡 |
| 2 | `SW-AUTHORING-INPUT-ADAPTER-01`：文件选择/DirectShow receipt 接同一 command | `20/18/14/9/8/8` | **77** | use-case 已就绪；产品交互壳和真实录音动作尚未冻结，可在01B后只换来源adapter |
| 3 | production authority/keyring/replay qualification | `18/10/8/9/6/5` | **56** | 量产必需，但真实账号、OS keystore、轮换/撤销和产品事务存储仍缺一手运行约束 |

选择85分 `SW-FAMILY-AUTHORING-01B`。实现前先识别 real-prelisten 与 companion compile 的最小公共编排；
只在第二条真实调用链确实产生重复时提取，保持两个现有默认 runner 行为与稳定合同不变。

## 硬件最新复排：外发包、benchmark SKU、仪器登记与共享 HTTP 证据收口后

本节是当前硬件线程的最新状态，覆盖上文较早快照；不改变隔离软件任务。

### 本轮新证据

- `HW-MB1-OUTBOUND-BUNDLE-V1`：三份 candidate-specific 人工邮件、附件请求、官方入口线索、
  回件路径与全输入/输出 SHA-256 manifest 已可确定性重建；bundle 保持 `PREPARED_NOT_SENT`，
  supplier replies 仍为 `0`。
- `HW-BENCHMARK-SKU-EVIDENCE-01`：宝宝巴士官方页把当前唯一在售款锁到 `G4`；九机商品
  `446637` 仍缺 G4/包装/背标/版本页同框证据。`REF1–REF3` 已从错误的 `READY_TO_BUY`
  修正为 `SKU_EVIDENCE_REQUIRED / SELLER_PHOTO_REQUIRED / REPLACEMENT_REQUIRED`。
- `HW-LAB-INSTRUMENT-REGISTRATION-V1`：9 个方法和 6 个逻辑槽位保持不变，新增 7 件必需
  物理资产、铭牌/serial、校准/自检及 bytes/SHA-256 资格门；本机 PnP 只发现内置相机、
  音频端点和 COM1，qualification effect 为 `NONE_DISCOVERY_ONLY`。真实 registry 仍为 `0`。
- `HW-EDA-SHARED-HTTP-DESIGN`：源码/运行态证明共享 Streamable HTTP 路径成立；隔离端口单
  session 探针 10/10。真实 49620 bridge、双 Codex client、并发、重连和回滚仍 `PENDING`，
  所以全局配置与 keeper 保持原样。

### 当前候选

| 排名 | 工作包 | 分项 | 总分 | 执行门与当前动作 |
|---:|---|---|---:|---|
| 1 | `HW-MB1-SEND-AND-FREEZE` | `30/18/20/10/7/9` | **94** | 运行 `validate:vendor-outbound` 后，由采购人员通过当前官方入口发送；回件进入 Vendor Evidence v1 |
| 2 | `HW-BENCHMARK-BUY-AND-INTAKE` | `24/18/19/10/8/7` | **86** | **条件候选**；仅对已通过卖家照片/SKU 门的 REF 付款和到货 intake，当前无 REF 通过 |
| 3 | `HW-BENCHMARK-SKU-PROOF` | `24/13/16/10/9/7` | **79** | 先向 REF2 卖家取得 G4、包装、背标、版本页和商品 446637 同框原件；REF1/REF3 继续补候选 |
| 4 | `HW-LAB-INSTRUMENT-REGISTRATION` | `18/18/15/9/8/7` | **75** | 人工盘点 LAB1–LAB6 铭牌/serial/校准；缺项在盘点后进入精确采购 |
| 5 | `HW-EDA-SHARED-HTTP-POC` | `16/18/5/10/7/7` | **63** | 仅在下一包依赖多任务 live EDA 时，受控迁移并完成双 client/重连/回滚矩阵 |
| 6 | `HW-EDA-SKELETON` | `15/16/5/9/7/5` | **57** | 系统骨架已足够；chip/pin/rail/connector/layout 继续锁定 |
| 7 | 芯片级自研 PCB | `10/4/4/4/5/2` | **29** | 合格一体主板候选尚未经两套同版实物判失格，保持锁定 |

### 当前选择

最高收益动作仍是 94 分的真实 MB1 外发；本轮已把其本地准备收敛到可复算、可直接复制的发送包，
但没有把“已准备”写成“已发送”。并行的第二个人工动作是 79 分 benchmark SKU 补证；86 分采购
包只有在单个 REF 的证据门通过后才变为可执行。没有新增外部事实时，继续填写芯片、引脚、电压、
连接器或 PCB 细节会越过 `BOARD_TARGET=UNRESOLVED` 门，因此不以低收益 EDA 工作替代上述动作。

## 并行软件任务：Family Authoring 01B 收口后复排

本节只约束 `tasks/system-product-rd` 软件任务。`SW-FAMILY-AUTHORING-01B` 已取得以下可复算证据：

- 静态 preview 与 authored preview 成为两个可执行调用链；共同的 challenge→natural-end presentation→
  显式动作→proof/provider→BuildAuthorization 顺序被提取到 App-local use-case，未建立跨 App 公共包；
- 新用例确定性5/5，报告 SHA-256
  `77c589de21123829fdaef5c65be3932069d7be28328a0ae094cbf7def56ac009`；
- 原 authoring 仍为15/15且报告字节未变；原 prelisten 19/19、host-process 16/16保持；
- CLI 所选 canonical WAV 经新 FamilyRevision/CAS、BuildPlan、materialized workspace、完整 decode、
  10/10固定 ffplay、显式 runner 动作、provider/BuildAuthorization 和唯一 compiler dispatch，生成
  authored `design:` Snapshot；替换音频在最终 Snapshot 中逐字节复算；
- real-authored 为10/10，最新报告 SHA-256
  `8d0c3fbc45f5eb75b94755f74c8b86035bce08afe2c155648799dff78acd991d`；
- 报告继续把人员听觉、真实监护身份、生产 authority、声学回采、目标音频和目标安装标为独立门。

当前软件候选重新评分：

| 排名 | 软件工作包 | 分项 | 总分 | 证据判断 |
| ---: | --- | --- | ---: | --- |
| 1 | `SW-AUTHORING-CAPTURE-ADAPTER-01`：DirectShow capture→canonical receipt→同一 authored use-case | `24/19/15/10/8/7` | **83** | 固定 ffmpeg、录音 staging/独占发布16/16与 authored链均就绪；真实设备名、权限和一次实际采集仍需主机证据 |
| 2 | `SW-AUTHORING-PRODUCT-SHELL-01`：文件选择/录音权限/预听确认的产品壳端口 | `19/14/12/9/6/6` | **66** | CLI文件入口已证明端口形状；UI框架、平台权限与家庭任务测试尚未选定，先不固化页面架构 |
| 3 | production authority/keyring/replay qualification | `20/11/9/9/6/5` | **60** | provider合同成熟，真实账号、OS keystore、轮换/撤销和产品事务存储仍缺运行约束 |
| 4 | `SW-DEVICE-INSTALL-COMPOSITION-01`：authorized Snapshot→DeviceLink port | `18/14/8/10/5/4` | **59** | DeviceLink transcript成熟；目标传输、介质与板级恢复证据尚未冻结，只适合先做host port而非目标实现 |

选择83分 `SW-AUTHORING-CAPTURE-ADAPTER-01`。先让现有 DirectShow adapter 产出的 canonical WAV 进入
同一 `commitImportedClipReplacement` 与 verified-prelisten/authorized-compile 路线；软件验收用注入式
capture port覆盖成功、取消、超时和发布清理，真实麦克风门只在提供设备名并完成实际采集后关闭。

## 软件任务：Capture Adapter 收口后复排

`SW-AUTHORING-CAPTURE-ADAPTER-01` 已取得以下机器证据：

- App-local `capture-source-use-case` 只依赖 `capture / import / discard` 端口；DirectShow、设备名、
  FFmpeg 参数与临时路径全部留在 adapter；
- 成功 fixture 使用真实 golden WAV 字节，进入既有 immutable FamilyRevision、BuildPlan、完整 natural-end
  presentation、BuildAuthorization 与 authorized design Snapshot；
- 确定性验收 **12/12**，报告 SHA-256
  `5eb3a3e70e4960b69ec40b3901d1529a4f7a3f5a3b1ec42ee447ec4d6a0a1d03`；覆盖预取消、运行中取消、
  timeout、坏 recorder receipt、import failure 和 cleanup failure，全部停在 revision commit 之前；
- 原 prelisten 19/19、host-process 16/16、verified-prelisten 5/5、authoring 15/15保持；选文件真实主机链
  继续为10/10，证明新增录音入口没有建立第二套 downstream；
- 真实设备名、OS 权限和一次实际麦克风采集仍是单列 host receipt，不由 fixture 代替。

本包同时给出一个新的可复算维护事实：canonical asset 会先于 metadata CAS 发布；import 后取消、CAS
竞争或 cleanup failure 都可能留下**未被任何 FamilyRevision 引用的不可变对象**。来源 adapter 增多后，
这一类对象会持续累积。现有 Family Export 已能闭合全部历史引用资产，因此 mark 集合与 orphan fixture 均已就绪。

当前软件候选重新评分：

| 排名 | 软件工作包 | 分项 | 总分 | 证据判断 |
| ---: | --- | --- | ---: | --- |
| 1 | `SW-ASSET-VAULT-MAINTENANCE-01`：全历史引用 mark→dry-run→保留期清理 adapter | `20/20/16/13/8/8` | **85** | 内容寻址 vault、完整历史导出闭包和真实 orphan 场景均已存在；可用 fixture 关闭引用保护、竞态、篡改、dry-run 与幂等，不依赖 UI/硬件 |
| 2 | `SW-AUTHORING-PRODUCT-SHELL-01`：source/permission/metadata/confirmation 产品壳 | `21/15/13/10/6/6` | **71** | 文件与录音端口已就绪；UI runtime、OS permission UX、家庭任务测试和第二产品壳尚未冻结，只适合后续薄壳组合 |
| 3 | production authority/keyring/replay qualification | `20/11/9/9/6/5` | **60** | provider合同成熟，真实账号、OS keystore、轮换/撤销和产品事务存储仍缺运行约束 |
| 4 | `SW-DEVICE-INSTALL-COMPOSITION-01`：authorized release Snapshot→DeviceLink port | `18/14/8/10/5/4` | **59** | DeviceLink transcript成熟；当前 authored结果仍为`design:`，production authority与release Snapshot门尚未关闭 |

选择85分 `SW-ASSET-VAULT-MAINTENANCE-01`。先建立只读 inventory/mark 与 dry-run report，再允许显式保留期
清理；FamilyRevision/Repository/Export 合同只作为输入，GC 只删除符合内容寻址命名、超出保留期且在清理前
二次确认仍未引用的对象。这样新增 TTS、云下载和更多录音来源时，不把孤儿对象处理复制到各 adapter。

### 双线输入复核

上述选择在软件收口后再次读取了根硬件 anchor、HardwareSystem target binding、
`build/hardware-system-validation.json`、Contact Receipt v1 文档与报告，并以
[`hardware-software-sync-2026-08-04.md`](./hardware-software-sync-2026-08-04.md) 的接口表复核：

| 硬件增量 | 当前证据 | 软件影响 |
| --- | --- | --- |
| HardwareSystem topology | SHA-256 `98a87a1de9ee8dfa52ec68ebd00afbbf23fa3c18e0c2a75e34ba09da4a9c4e5f`，425/425 | 18条差异入口保持，无合同增删 |
| `BOARD_TARGET` / 18条 target bindings | `UNRESOLVED` / 全部待实物证据 | board adapter、codec、storage与DeviceLink target实现继续受门控 |
| Vendor Contact Receipt v1 | 合同10/10；真实records、submitted与reply均为0 | 只改善硬件证据账本，不改变软件输入 |
| codec / storage / USB / OID event | 没有新验收绑定 | 本轮增量影响 `NONE` |

因此本次硬件变化没有改变软件排序：asset-vault maintenance仍为85分第一名；DeviceLink composition
仍在 production authority 与 target transport evidence 之后。后续每个软件包都在启动、收口和复排时
重复同一**只读增量检查**；一旦硬件线冻结接口字段，软件只调整相应版本化合同、adapter或ReleaseGate，
不把板级细节扩散进Family/core。

## 硬件任务：官方联系入口与 Contact Receipt v1 收口后复排

本节是当前硬件路线的最新快照；软件线继续按上一节独立推进，两线在每个包开始与收口时交换版本化接口证据。

### 新增可复算事实

- Ztron、春苗和 Sonix FAE 共 4 份官方联系来源已按 HTTP status、bytes、SHA-256 复算为 4/4；
  source-set SHA-256 为 `7344e7c51d13742981b1d46e9443ab414b6d3a7d8d1223f29330de49fe7baf43`。
- Ztron 当前官方 `mailto:` 首选 `market3@ztrontech.com`，另列 `market2@ztrontech.com`；春苗官方页
  继续列出 `190530584@qq.com`；Sonix 当前 FAE 为会员登录后、带 Contact Email 和产品线字段的官方表单。
- 外发包仍为 `PREPARED_NOT_SENT`，当前 reproducible ID 为
  `sha256:3ef0820cdc323d0a1cf8dfb80ea918a6c707924025f95c78f17998d19f777d7d`。
- Contact Receipt v1 为 16/16，隔离文件闭包、重复 ID 与篡改拒绝 3/3；三条消息均已生成不可变、但仍为
  `PENDING_SEND` 的人工工作区。真实 receipt、supplier reply、READY_TO_BUY 和 accepted target 仍均为 0。
- 独立标杆复核确认：REF1 当前商品路径售罄/JD 无商品事实；REF2 的官方 G4 与九机 `446637` 仍缺待发
  实物同框等式；REF3 身份标识未闭合且美元价格不进入既有低价拆解门。三项继续不具备付款条件，79分
  补证包与86分条件采购包的门和顺序均不变。
- 软件最近完成的 capture adapter 与下一 asset-vault maintenance 均停留在 host/companion 边界，
  对18条 HardwareSystem 接口、target binding 和 BOM 的当前影响为 `NONE`。

### 当前候选

| 排名 | 工作包 | 分项 | 总分 | 当前门与动作 |
|---:|---|---|---:|---|
| 1 | `HW-MB1-SEND-AND-FREEZE` | `30/20/20/10/7/9` | **96** | 官方入口与逐次回执工作区已就绪；人员实际发送后等待书面回件，两套同版实物仍是冻结门 |
| 2 | `HW-BENCHMARK-BUY-AND-INTAKE` | `24/18/19/10/8/7` | **86** | 条件候选；当前没有 REF 通过精确 SKU/卖家同框门 |
| 3 | `HW-BENCHMARK-SKU-PROOF` | `24/13/16/10/9/7` | **79** | 向 REF2 卖家取得 G4、包装、背标、版本页与商品号同框原件 |
| 4 | `HW-LAB-INSTRUMENT-REGISTRATION` | `18/18/15/9/8/7` | **75** | 登记 LAB1–LAB6 实物铭牌、serial、校准或可追溯自检 |
| 5 | `HW-EDA-SHARED-HTTP-POC` | `16/18/5/10/7/7` | **63** | 仅在多任务 live EDA 成为直接前置时做真实双 client/重连/回滚 |
| 6 | `HW-EDA-SKELETON` | `15/16/5/9/7/5` | **57** | 现有层级与18接口骨架足够，芯片级字段继续锁定 |
| 7 | 芯片级自研 PCB | `10/4/4/4/5/2` | **29** | 当前一体板候选尚未经两套同版实物判失格 |

### 选择

联系入口补证使首项的证据就绪度由18提升为20，总分由94提升为96；当前最高收益动作仍是实际提交三份
询证并保存回执，而不是继续扩展本地设计。硬件线程等待外部回件时可并行推进79分卖家同框补证和75分
仪器实物登记；软件线程继续自己的85分 asset-vault maintenance。任一线的接口合同、外部回件、实物或
测量发生变化后，再按同一权重同步复排。

## 软件任务：Asset Vault Maintenance 收口后复排

### 新增可复算事实

- `SW-ASSET-VAULT-MAINTENANCE-01` 已完成：全历史 RepositoryBackup mark、逐字节 inventory、不可变
  dry-run plan、显式 retention、稳定引用租约和 conditional quarantine/purge；
- 21/21 真实文件/故障注入验收连续两次得到相同报告 SHA-256
  `c56e2acd468518334d8fb299ceb7d99aa0c4135f6c65b1ee810e067dc9b164df`；新增故障门证明提交前
  quarantine 失败全回滚，捕获到的部分 purge 明确报告已删前缀、恢复其余对象并可重新规划；
- 11个历史 digest（含被新 revision 替换的旧资产）全部保护；老 orphan 删除、年轻 orphan 保留；
- 新 revision 引用、candidate 换字节、篡改、引用缺失、异常目录、非托管文件和资源漂移均在删除前使计划失效或阻断；
- 同进程 coordinator 已证明 cleanup 持有稳定引用租约时 mutation 排队，但产品组合根尚未集中持有
  repository、vault、coordinator 和全部 source 入口。这是当前最直接的绕行风险，而不是再新增一套 GC 合同。

### 硬件收口同步

硬件线新增 4/4 官方联系来源、Contact Receipt 16/16 + 3/3 隔离自检与新的确定性外发包身份；真实 receipt、supplier reply、
READY_TO_BUY、accepted target 和 released BOM 仍为 0。HardwareSystem topology SHA-256 仍为
`98a87a1de9ee8dfa52ec68ebd00afbbf23fa3c18e0c2a75e34ba09da4a9c4e5f`，425/425，18条 target binding 仍为
`TARGET_EVIDENCE_PENDING`。最新 `HW-BENCHMARK-SKU-PROOF-FOLLOWUP-01` 仍将 REF1–REF3 保持在补证/替换门，
没有形成板卡、光头、固件或介质常量。因此本软件包及下一 host composition 对 codec、OID event、USB 和目标
storage 的影响仍为 `NONE`。

### 当前软件候选

| 排名 | 软件工作包 | 分项 | 总分 | 证据判断 |
|---:|---|---|---:|---|
| 1 | `SW-FAMILY-WORKSPACE-COMPOSITION-01`：统一 repository/vault/reference coordinator/source ports | `23/20/17/14/8/8` | **90** | 所有端口与共同向量已存在；集中组合可机器保证 authoring 与 GC 共用租约，直接降低后续 UI/TTS/录音入口成本 |
| 2 | `SW-ASSET-VAULT-RECOVERY-01`：持久化 operation journal/startup recovery | `21/19/15/12/8/7` | **82** | 普通 purge I/O 部分失败已闭合；进程中断、持续 rollback/目录清理故障、跨进程 lease、根目录替换与流式资源门仍需产品 storage adapter 证据 |
| 3 | `SW-AUTHORING-PRODUCT-SHELL-01`：source/permission/metadata/confirmation 薄壳 | `22/16/14/11/6/6` | **75** | 业务端口已就绪，但 UI runtime、OS permission UX 与真实家庭任务测试尚未冻结；应建立在统一 workspace 之上 |
| 4 | production authority/keyring/replay qualification | `20/11/9/9/6/5` | **60** | provider 合同成熟，真实账号、OS keystore、轮换/撤销与产品事务存储仍缺运行约束 |
| 5 | `SW-DEVICE-INSTALL-COMPOSITION-01` | `18/14/8/10/5/4` | **59** | DeviceLink transcript 成熟；release Snapshot、production authority 与 target transport evidence 尚未关闭 |

选择90分 `SW-FAMILY-WORKSPACE-COMPOSITION-01`。下一包只建立 App-local workspace factory 和真实
AtomicJson composition：由它唯一创建 repository、asset vault、reference coordinator 与 source import ports，
authoring mutation 和 maintenance 通过同一入口；不选择 UI 框架，也不改变 Family/Export/Compiler 合同。完成后产品壳只需
提供权限、文件/录音选择、metadata 与确认动作，新增 TTS 或云下载时也只增加 source adapter。

## 硬件任务：Lab Registration Capture v1 收口后复排

### 新增可复算事实

- 六个稳定仪器槽位与七类物理资产已提取到 `registration-capture-plan.json`，准备脚本与校验器读取同一事实源；
- `serialSource` 区分制造商序列号和拍照留证的本地资产标签；可追溯自检分别闭合身份、自检结果与参考标准原件；
- registry 文件名/ID唯一性和 Windows 反斜杠跨 registry 路径进入负向门；Lab v1 当前 **178 checks**；
- 准备层自检 **3/3**，证明 pending-only 6槽位/7资产工作区、输入hash闭包、重复ID拒绝和零record晋级；
- 已建立 `EVT0-LAB-REGISTRY-20260804-01` 工作区，raw、records、qualified仍均为0；
- 软件线最新 Asset Vault 为21/21、报告
  `c56e2acd468518334d8fb299ceb7d99aa0c4135f6c65b1ee810e067dc9b164df`，下一 FamilyWorkspace
  composition 仍属host边界；对本硬件包影响为 `NONE`。

### 当前候选

| 排名 | 工作包 | 分项 | 总分 | 当前门与动作 |
|---:|---|---|---:|---|
| 1 | `HW-MB1-SEND-AND-FREEZE` | `30/20/20/10/7/9` | **96** | 人员按三份 checklist 实际发送并保存 Message-ID/确认号/FAE 工单；回件后才进入付款与两套同版实物门 |
| 2 | `HW-BENCHMARK-BUY-AND-INTAKE` | `24/18/19/10/8/7` | **86** | 条件候选；当前无 REF 通过精确 SKU/卖家同框门 |
| 3 | `HW-BENCHMARK-SKU-PROOF` | `24/13/16/10/9/7` | **79** | 向 REF2 卖家取得 G4、446637、包装/背标/版本页/原配点读物同一待发实物原件 |
| 4 | `HW-LAB-INSTRUMENT-REGISTRATION` | `18/20/15/9/8/7` | **77** | 准备证据由18升20；按现成 6/7 checklist 拍摄铭牌、serial/asset tag、证书或可追溯自检 |
| 5 | `HW-EDA-SHARED-HTTP-POC` | `16/18/5/10/7/7` | **63** | 仅在多任务 live EDA 成为直接前置时迁移 |
| 6 | `HW-EDA-SKELETON` | `15/16/5/9/7/5` | **57** | 现有18接口骨架足够；芯片级字段继续锁定 |
| 7 | 芯片级自研 PCB | `10/4/4/4/5/2` | **29** | 一体板候选仍未经过两套同版实物判失格 |

### 选择

总体最高收益仍是96分的真实 MB1 外发。等待外部回件期间，本地下一高收益工作是79分的 REF2 卖家
同框补证准备；77分 Lab 包已经把本地模板摩擦降到最低，下一增量必须来自实际仪器照片、序列/资产标签、
校准证书或参考标准自检。继续扩展空模板、芯片级EDA或预买板相关器件均低于这两条实物证据路径。

## 硬件任务：Benchmark Seller Evidence v1 收口后复排

### 新增可复算事实

- 官方 G4 来源继续为 `56,144` bytes、SHA-256
  `9815C1B1BB723C86D793285BDFD5607332BAF1D7ADE1FD923DBE20BC6406A0A5`；官方表也证明 G3/G4
  同为 32G/WiFi/Type-C，因此这三个参数不足以单独排除 G3；
- REF2 profile 锁定官方/零售 source ID、grade、bytes、SHA-256，并把九机字段 `110329` 隔离为网页字段；
- 11项门增加“订单→包装→开箱→背标/SN→开机版本页→全套点读物”的连续卖家原视频绑定；
- 合同校验 20/20，准备/隔离自检 9/9；只改decision、跨record路径、hash篡改、effect晋级和未来时间线均被拒绝；
- `REF2-SELLER-EVIDENCE-20260804-01` 已准备，但 request仍为 `PREPARED_NOT_SENT`，raw/records/complete
  均为0；这提升证据就绪度，没有缩短真实回件与到货的物理距离；
- 软件owner权威基线仍为 Asset Vault 21/21；收口时出现更新于owner锚点的 FamilyWorkspace 30/30报告，
  SHA-256 `0cdfd87e607d48dbfb0226601451409e9a4f15d18ea613eb9767f690ae80b8e2`，边界显式为
  `hardwareImpact=NONE`。在软件owner发布收口前它只作为进行中工件，硬件排序不变。

### 当前候选

| 排名 | 工作包 | 分项 | 总分 | 当前门与动作 |
|---:|---|---|---:|---|
| 1 | `HW-MB1-SEND-AND-FREEZE` | `30/20/20/10/7/9` | **96** | 人员执行三份现成 checklist，保存真实 Message-ID/确认号/FAE工单；回件后进入五元组和两套同版门 |
| 2 | `HW-BENCHMARK-BUY-AND-INTAKE` | `24/18/19/10/8/7` | **86** | 条件候选；目前没有 REF 达到人工复核完整态，暂不进入购买/到货包 |
| 3 | `HW-REF2-SELLER-EVIDENCE-SEND-AND-CAPTURE` | `24/18/16/10/9/8` | **85** | 发送现成请求，取得11项原件并通过独占路径/hash/连续视频门；证据就绪13→18、返工风险7→8 |
| 4 | `HW-LAB-INSTRUMENT-REGISTRATION` | `18/20/15/9/8/7` | **77** | 按现成6槽位/7资产 checklist 采集铭牌、serial/asset tag、证书或参考标准自检 |
| 5 | `HW-EDA-SHARED-HTTP-POC` | `16/18/5/10/7/7` | **63** | 仅在并行 live EDA 直接阻塞设计时迁移；当前不解锁实物目标 |
| 6 | `HW-EDA-SKELETON` | `15/16/5/9/7/5` | **57** | 18接口骨架已足够；芯片级字段继续保持证据锁 |
| 7 | 芯片级自研 PCB | `10/4/4/4/5/2` | **29** | 一体板候选尚未经过书面回件与两套同版实物判失格 |

### 选择

最高收益仍是96分的真实 MB1 发送；这是冻结目标主板/OID五元组的直接前置。REF2 的本地准备工作已收口，
下一增量必须来自实际发送和卖家原件，因此85分包成为第二条可立即执行的人工路径。86分购买/intake分值更高，
但仍受85分证据包门控。Lab物理登记可并行；EDA共享传输与芯片级设计继续后排，避免用本地工具工作替代实物闭环。

## 软件任务：FamilyWorkspace Composition 收口后复排

### 新增可复算事实

- `SW-FAMILY-WORKSPACE-COMPOSITION-01` 已完成：一个 App-local factory 私有创建真实 Atomic JSON
  repository、canonical WAV vault、`FamilyAssetReferenceCoordinator` 与 file/capture source ports；
- 公开对象只含 read/authoring/maintenance/transfer capability；raw repository、coordinator、vault、通用
  commit 和自选 reference/vault port 均未暴露；同一路径、同配置在一个进程内复用同一实例；
- file/capture import、initial/authoring commit、maintenance apply、complete export 和 portable repository restore
  共用同一排他队列；独立审查复现并关闭了 GC lease/reimport 删除竞态；
- Family Export v1 的 `assets/<sha>.bin` 未改变；新的 canonical adoption 在 staging 中复用既有 inspector，
  重新 probe 后发布为 `assets/sha256/<sha>.wav`，再执行 portable restore；
- 34/34 真实文件验收连续复算报告 SHA-256
  `094f7607beed195854f4083a1f8851b33af8fcf3bfd62295a66d913e56837254`；覆盖 capability 表面、伪造
  receipt、同一队列、重开、未标记目录、distinct epoch、staging 清理、发布后 adapter 配置失败原子性与重试；
- 独立复审结论为无 P0/P1。开放边界是多进程 writer、持久化 purge journal、根替换 race、父目录 fsync、
  真实介质掉电，以及未来多库产品壳的显式生命周期。

### 硬件收口同步

硬件线新增 Benchmark Seller Evidence v1 的20/20合同与9/9准备自检，但 request仍为
`PREPARED_NOT_SENT`，raw/records/complete、真实 MB1 receipt/reply、accepted target 和 released BOM 均为0。
`BOARD_TARGET=UNRESOLVED`，HardwareSystem 仍为425/425且18条 target binding待实物证据。没有新增 codec、
storage、USB、OID event 或 board adapter 绑定；FamilyWorkspace 也没有引入设备端写入/存储假设，双线增量影响为 `NONE`。

### 当前软件候选

| 排名 | 软件工作包 | 分项 | 总分 | 证据判断 |
|---:|---|---|---:|---|
| 1 | `SW-ASSET-VAULT-RECOVERY-01A`：持久化 maintenance journal + startup recovery | `23/20/17/13/7/7` | **87** | 单一 workspace/queue 已就绪；当前明确缺口是进程中断后 quarantine/purge 状态与剩余对象恢复，可用 child-process kill/restart 和真实文件验收，不依赖 UI/硬件 |
| 2 | `SW-AUTHORING-PRODUCT-SHELL-01`：source/permission/metadata/confirmation 薄壳 | `23/17/15/12/6/6` | **79** | capability API 已稳定，壳层成本下降；UI runtime、OS permission UX 与真实家庭任务研究仍待冻结，现阶段直接选框架返工风险更高 |
| 3 | `SW-FAMILY-WORKSPACE-LIFECYCLE-01`：多库 close/reopen/adapter lifecycle | `15/15/12/10/7/7` | **66** | 独立复审已记录单进程 registry 生命周期；首发仍是一个家庭所有者，尚无第二个真实多库消费者 |
| 4 | production authority/keyring/replay qualification | `20/11/9/9/6/5` | **60** | provider合同成熟，真实账号、OS keystore、轮换/撤销和产品事务存储仍缺运行约束 |
| 5 | `SW-DEVICE-INSTALL-COMPOSITION-01` | `18/14/8/10/5/4` | **59** | DeviceLink transcript成熟；release Snapshot、production authority、target transport和介质证据仍在门外 |

### 选择

选择87分 `SW-ASSET-VAULT-RECOVERY-01A`。先只关闭单进程 App-owned vault 在进程中断后的持久化恢复：
版本化 journal 在删除前绑定 operation/plan/candidate identity，startup recovery 区分未开始 purge、已提交删除前缀和
剩余 quarantine，恢复后重新 inventory/plan。验收使用独立 child process 在受控 phase 退出再重启复算。
跨进程排他锁、父目录 fsync、根替换与真实掉电继续保留独立门，避免在缺少目标存储证据时扩大结论。

## 硬件任务：Shared HTTP POC v1 收口后复排

### 新增可复算事实

- 固定Node `v24.18.1`及`easyeda-mcp-pro 0.35.4`本机文件bytes/SHA-256；上游固定tag/commit交叉核验；
- 隔离`49642/49643`上两个生命周期cycle：一个PID同时拥有bridge/HTTP两个loopback listener；
- 两个逻辑MCP session ID不同、71项工具面相同，DELETE A后A为404而B继续工作；
- 服务重启后旧session为404，新session重建；两次停止后端口全部释放；
- live `49620` owner前后均为PID `10344`；Codex配置、HardwareSystem、target-binding、BOM与采购计划哈希一致；
- 运行门31/31、第二校验器复算20/20；完整child listener集合、只读scope反证、禁用feature flags、独立runtime storage及live `49620` listener/两端ESTABLISHED记录均闭合。真实JLCEDA、两个独立Codex task、真实EDA并发、URL切换与stdio回滚仍待维护窗口；
- 软件线在POC运行期间正式收口FamilyWorkspace 34/34，报告SHA-256
  `094f7607beed195854f4083a1f8851b33af8fcf3bfd62295a66d913e56837254`；其`hardwareImpact=NONE`，硬件排序不变。

### 当前硬件候选

| 排名 | 工作包 | 分项 | 总分 | 当前门与动作 |
|---:|---|---|---:|---|
| 1 | `HW-MB1-SEND-AND-FREEZE` | `30/20/20/10/7/9` | **96** | 人员实际发送三份询证并保存Message-ID/确认号/FAE工单 |
| 2 | `HW-BENCHMARK-BUY-AND-INTAKE` | `24/18/19/10/8/7` | **86** | 条件候选；仍受下一项卖家原件门控 |
| 3 | `HW-REF2-SELLER-EVIDENCE-SEND-AND-CAPTURE` | `24/18/16/10/9/8` | **85** | 发送现成请求并取得11项同一待发物原件 |
| 4 | `HW-LAB-INSTRUMENT-REGISTRATION` | `18/20/15/9/8/7` | **77** | 采集6槽位/7资产的身份、校准或参考自检原件 |
| 5 | `HW-EDA-SHARED-HTTP-LIVE-MIGRATION` | `16/20/5/10/6/7` | **64** | POC已提高证据就绪；受控窗口执行真实双task、连通、crash/restart与stdio回滚 |
| 6 | `HW-EDA-SKELETON` | `15/16/5/9/7/5` | **57** | 现有18接口骨架足够；chip/pin/rail/connector/layout继续锁定 |
| 7 | 芯片级自研PCB | `10/4/4/4/5/2` | **29** | 一体板候选尚未经过书面证据和两套同版实物判失格 |

最高收益仍是真实MB1外发；当前没有应越过供应商/实物证据门而提前执行的芯片级设计包。共享HTTP真实迁移
仅在用户安排短维护窗口、且需要并行live EDA读取时执行。

## 软件任务：Asset Vault Recovery 01A 收口后复排

### 新增可复算事实

- `SW-ASSET-VAULT-RECOVERY-01A` 已完成：canonical journal在首个资产移动前绑定operation、plan、
  reference state、inventory、固定资源策略和严格有序候选；purge逐项持久记录连续已删前缀；
- FamilyWorkspace在repository/capture/capability初始化前执行startup recovery，plan/apply与恢复共用同一
  `maintenanceLimits`；策略漂移显式失败；恢复只归一化当前物理状态并要求fresh inventory/plan，不续跑旧计划；
- 6个独立child-process退出窗口、重复启动幂等、fresh-plan/apply收敛和5类非canonical/篡改/歧义负例合计
  **70/70**；报告SHA-256为
  `65c2923ada29eb98c65b2d4f83d4b7da971b4c4fb1ef588bff75b20880ecb474`；
- 原Asset Vault Maintenance仍为21/21、FamilyWorkspace仍为34/34且报告字节身份保持；独立研究与代码审计
  未发现P0/P1阻断项；
- 当前结论限定为单进程App-owned workspace和已等待文件系统调用后的受控进程退出。跨进程writer、
  parent-directory fsync、root replacement、恢复回执持久审计与真实掉电保持独立证据门。

### 硬件收口同步

软件收口前再次只读根硬件anchor、HardwareSystem target binding、共享HTTP POC与最新外部证据状态：

- `BOARD_TARGET=UNRESOLVED`，HardwareSystem保持425/425，18条target binding仍为
  `TARGET_EVIDENCE_PENDING`；
- Shared HTTP隔离POC为31/31 + 20/20，live保护态零变化；真实迁移仍等待受控维护窗口；
- Benchmark Seller Evidence为20/20合同与9/9准备/隔离自检，但request仍为`PREPARED_NOT_SENT`，
  raw/records/complete均为0；真实MB1 receipt/reply、accepted target、released BOM和Lab qualified仍均为0；
- 没有codec、storage、USB、OID event或board adapter新绑定。本软件包只处理host vault namespace，
  `hardwareImpact=NONE`；设备存储原子性仍由`IF-STORAGE`、DeviceLink、目标介质和掉电HIL持有。

### 当前软件候选

历史段落保留当时评分；本轮重新执行100分权重约束，六个分项均不超过`30/20/20/10/10/10`：

| 排名 | 软件工作包 | 分项 | 总分 | 证据判断 |
|---:|---|---|---:|---|
| 1 | `SW-AUTHORING-PRODUCT-SHELL-01A`：framework-neutral source/permission/metadata/prelisten/confirmation会话内核 | `26/19/16/10/8/7` | **86** | FamilyWorkspace capability与文件/录音/预听/授权纵切均已验收，成熟产品也共同采用“选择或录制→回听→确认→同步”任务；先冻结状态/端口/失败语义，可关闭首个用户任务而不押注UI框架 |
| 2 | `SW-FAMILY-WORKSPACE-LIFECYCLE-01`：多库close/reopen/adapter lifecycle | `15/15/12/10/7/7` | **66** | OPEN_WORKSPACES生命周期缺口已知；首发仍是一个家庭所有者，尚无第二个真实多库消费者 |
| 3 | `SW-CROSS-PROCESS-WRITER-LEASE-01` | `18/14/10/9/5/5` | **61** | 能强化本地存储边界，但当前产品组合只有一个进程owner，OS锁/崩溃lease和root替换需另做平台证据 |
| 4 | production authority/keyring/replay qualification | `20/11/9/9/6/5` | **60** | provider合同成熟；真实账号、OS keystore、轮换/撤销和产品事务存储仍缺运行约束 |
| 5 | `SW-DEVICE-INSTALL-COMPOSITION-01` | `18/14/8/10/5/4` | **59** | DeviceLink transcript成熟；release Snapshot、production authority、target transport和介质证据仍在门外 |

### 选择

选择86分`SW-AUTHORING-PRODUCT-SHELL-01A`。首步先基于成熟产品官方流程与现有host纵切建立可复算的
任务/失败矩阵，再实现纯会话内核与FamilyWorkspace capability ports：source选择、权限结果、metadata、预听、
显式确认、取消和重试均由状态机持有；文件选择器、DirectShow、未来TTS、UI框架和OS权限留在adapter。
该包不复制FamilyRevision、BuildPlan、Confirmation或compiler语义，也不在缺少第二真实壳时提取跨App公共包。

## 硬件任务：MB1 Send Preflight 01 收口后复排

### 新增可复算事实

- 发送日四项官方联系来源复算4/4，source-set SHA-256仍为
  `7344e7c51d13742981b1d46e9443ab414b6d3a7d8d1223f29330de49fe7baf43`；
- 新增发送前 checker：三份已准备工作区各25/25，统一验证 draft Schema、pending事实、冻结
  manifest/message/recipient、sourceRef/官方URL、空raw目录、正式record空位和13文件tree；
- 隔离自检4/4覆盖完整闭包、消息篡改、raw残留和record ID冲突；
- 三份工作区均为`READY_FOR_MANUAL_SUBMISSION / PENDING_SEND`，真实receipt/submitted/response仍为0；
- 本机PnP刷新只观察到主机音频端点与COM1，`qualificationEffect=NONE_DISCOVERY_ONLY`，Lab records/qualified仍为0；
- 软件Asset Vault Recovery 70/70已正式收口；Authoring Product Shell已启动但尚处执行期，当前两者
  `hardwareImpact=NONE`。

### 当前硬件候选

| 排名 | 工作包 | 分项 | 总分 | 当前门与动作 |
|---:|---|---|---:|---|
| 1 | `HW-MB1-SEND-AND-FREEZE` | `30/20/20/10/7/9` | **96** | preflight 3/3已通过；人员实际发送并保存Message-ID/确认号/FAE工单 |
| 2 | `HW-BENCHMARK-BUY-AND-INTAKE` | `24/18/19/10/8/7` | **86** | 条件候选，继续受REF2卖家原件门控 |
| 3 | `HW-REF2-SELLER-EVIDENCE-SEND-AND-CAPTURE` | `24/18/16/10/9/8` | **85** | 发送现成请求并取得11项同一待发物原件 |
| 4 | `HW-LAB-INSTRUMENT-REGISTRATION` | `18/20/15/9/8/7` | **77** | PnP没有发现可晋级仪器；采集6槽位/7资产实物原件 |
| 5 | `HW-EDA-SHARED-HTTP-LIVE-MIGRATION` | `16/20/5/10/6/7` | **64** | 保留到短维护窗口 |
| 6 | `HW-EDA-SKELETON` | `15/16/5/9/7/5` | **57** | 继续复用18接口系统骨架 |
| 7 | 芯片级自研PCB | `10/4/4/4/5/2` | **29** | 一体板书面证据与两套同版实物门前保持锁定 |

### 选择

96分真实MB1外发仍是当前最高收益动作。preflight已经关闭可自治的最后一个发送前漂移缺口；
下一增量来自真实提交原件和供应商回件。等待用户执行外部动作时，REF2卖家请求与Lab实物盘点可并行；
目标板、芯片、引脚、电源、连接器、布局和板相关采购继续受证据门约束。

## 软件任务：Authoring Product Shell 01A 收口后复排

### 新增可复算事实

- framework-neutral产品任务已经收敛为App-local纯transition core、异步用例、source/capability ports与
  FamilyWorkspace窄adapter；产品API没有直接confirmation动作；
- FILE与CAPTURE都生成相同的sanitized immutable asset receipt；绝对路径、设备名、OS permission payload、
  adapter receipt/error code、动态producer字段和capture staging不进入session/FamilyRevision/BuildPlan；
- permission公共identity由会话/attempt/capability/status内容寻址，异常只保留固定stage/category代码，
  durable producer由controller固定为非敏感build identity；
- frozen commit command支持真实repository响应丢失后的原字节replay；`STALE_HEAD`进入fresh-session conflict；
  commit进行中由non-abortable truth barrier保护；
- review receipt同时绑定session/revision/binding/clip/asset/BuildPlan/preview/transcript/confirmation/
  authorization；拒绝和串绑均保留durable revision且不产生authorization，fixture receipt不提升`buildAuthorized`；
- 真实FamilyWorkspace public capabilities验收为**33/33**，两次运行报告SHA-256均为
  `e4dd6694ece3acfa2bde4ca80d80701c27c1143067eafe70620cd03776d88eeb`；原authoring 15/15、capture 12/12、
  FamilyWorkspace 34/34报告身份保持。

### 硬件收口同步

本包执行期间并行硬件owner收口了EDA System Skeleton，因此root hardware anchor、benchmark与lab报告bytes发生过
owner侧刷新；本软件线重新读取后，其证据语义没有新增。最终full前后hardware anchor、topology、target-binding及
HardwareSystem/Shared HTTP/benchmark/vendor/lab报告SHA-256逐项相同：

- `BOARD_TARGET=UNRESOLVED`，18条interface binding继续等待target evidence；
- Shared HTTP POC、MB1 preflight、Benchmark Seller和Lab状态无增量；真实MB1提交/回复、accepted target、
  released BOM与qualified lab记录仍为0；
- codec、storage、USB、OID event、board adapter均无新绑定，本包`hardwareImpact=NONE`；
- `offlineReady`在所有产品壳验收中固定为false，后续只接受DeviceDelivery与目标实物receipt。

### 当前软件候选

100分权重继续为关键路径/证据就绪/可验证闭环/复用收益/成本/低返工风险=`30/20/20/10/10/10`：

| 排名 | 软件工作包 | 分项 | 总分 | 证据判断 |
|---:|---|---|---:|---|
| 1 | `SW-TTS-SOURCE-ADAPTER-01` | `25/15/16/10/8/7` | **81** | 基础TTS属于首发切片；新source registry已证明FILE/CAPTURE零core分叉。现有`tts-l0.mjs`仍是legacy CLI，engine/codec/network/cache语义不稳定，下一包先建立provider receipt→canonical WAV→FamilyWorkspace import的确定性fixture与端口，不直连未资格化engine |
| 2 | `SW-AUTHORING-TASK-RECOVERY-01` | `23/17/17/9/6/6` | **78** | commit response-loss已闭环，但进程退出会丢失in-memory frozen command/review attempt；可复用现有journal经验，仍需先冻结用户可见恢复/放弃语义 |
| 3 | `SW-DESKTOP-AUTHORING-UI-ADAPTER-01` | `27/12/12/8/5/6` | **70** | 最接近真实用户任务；UI框架、平台permission与可用性基准尚未选择，直接实现返工较高 |
| 4 | `SW-FAMILY-WORKSPACE-LIFECYCLE-01` | `15/15/12/10/7/7` | **66** | 多库close/reopen缺口明确；首发仍为一个家庭owner |
| 5 | `SW-CROSS-PROCESS-WRITER-LEASE-01` | `18/14/10/9/5/5` | **61** | 强化存储边界；当前仍是单进程owner，平台锁证据成本较高 |
| 6 | production authority/keyring/replay qualification | `20/11/9/9/6/5` | **60** | 合同成熟，真实账号/keystore/轮换与生产事务约束仍缺 |
| 7 | `SW-DEVICE-INSTALL-COMPOSITION-01` | `18/14/8/10/5/4` | **59** | DeviceLink transcript成熟，仍受release Snapshot、target transport/storage与实物门约束 |

### 选择

当前最高收益是81分`SW-TTS-SOURCE-ADAPTER-01`：它直接补齐首发“真人录音/基础TTS”的第二类内容来源，
同时用第三个source证明“新增来源只增adapter/fixture，session core与FamilyWorkspace零修改”。第一步先调研并冻结
provider identity、联网/离线、权利/隐私、取消、资源门和canonical WAV转换证据；确定性fixture关闭端口合同后，
真实SAPI/本地模型/云provider各自通过qualification receipt进入。现有legacy TTS CLI保持原样，直到新adapter有
回归证据后再评估迁移。

## 硬件任务：EDA System Skeleton v1 收口后复排

### 新增可复算事实

- `topology.json` 仍是唯一块/接口事实源：12 blocks / 36 logical ports / 18 interfaces，canonical topology ID保持 `hwt:sha256:98a87a1de9ee8dfa52ec68ebd00afbbf23fa3c18e0c2a75e34ba09da4a9c4e5f`；
- role-only布局生成逻辑层级、12个leaf view、18接口登记、renderer-neutral write plan和SVG；换板/换头继续只改target binding、adapter、BOM revision及验收记录；
- 官方 `easyeda-api-skill` / `pro-api-sdk` 固定commit、文件bytes/SHA-256共10项复核一致；V3日志身份、Beta创建/文字/导出表面及`WIRE`网络语义均进入证据台账；
- generator/check 3/3，独立验证26/26，隔离负向门20/20；输出路径逃逸、器件/符号/引脚/物理网络/电源值/连接器/PCB字段注入均被拒绝；
- `nativeSourceGenerated=false`、`nativeExportGenerated=false`、EDA project仍为`UNSET/UNFROZEN`、`designWrite=false`，因此该包只关闭系统文档骨架，不产生芯片级或制造结论；
- 软件侧出现Authoring Product Shell 31/31候选报告，SHA-256 `c7c8cb54918dafe74210b31268c500c14012557bafddcfc7a9fec3f5e341189a`，边界仍为`hardwareImpact=NONE`；owner anchor正式切换前按`PENDING_OWNER_CLOSEOUT`处理。

### 当前硬件候选

| 排名 | 工作包 | 分项 | 总分 | 当前门与动作 |
|---:|---|---|---:|---|
| 1 | `HW-MB1-SEND-AND-FREEZE` | `30/20/20/10/7/9` | **96** | preflight已闭合；人员真实发送并保存Message-ID/确认号/FAE工单，回件后进入五元组和两套同版门 |
| 2 | `HW-BENCHMARK-BUY-AND-INTAKE` | `24/18/19/10/8/7` | **86** | 条件候选；继续受REF2同一待发物原件门控 |
| 3 | `HW-REF2-SELLER-EVIDENCE-SEND-AND-CAPTURE` | `24/18/16/10/9/8` | **85** | 发送现成请求，取得并归档11项卖家原件 |
| 4 | `HW-LAB-INSTRUMENT-REGISTRATION` | `18/20/15/9/8/7` | **77** | 采集6槽位/7资产的铭牌、serial/asset tag、校准或参考标准自检原件 |
| 5 | `HW-EDA-SHARED-HTTP-LIVE-MIGRATION` | `16/20/5/10/6/7` | **64** | 只在并行live EDA直接阻塞时安排受控维护窗口 |
| 6 | `HW-EDA-SYSTEM-SKELETON-CONTROLLED-APPLY` | `13/18/4/10/6/7` | **58** | 需隔离工程、scoped design-write、snapshot/readback/rollback；仍只创建矩形和文字 |
| 7 | 芯片级自研PCB | `10/4/4/4/5/2` | **29** | 一体板候选尚未经过书面回件和两套同版实物判失格 |

### 选择

真实MB1外发仍以96分显著领先，也是唯一能直接解锁目标五元组的动作。REF2卖家原件与Lab实物登记可并行。
本轮之所以执行原57分的系统骨架，是因为更高分的四项都等待人员发送、卖家/供应商或本地实物，而共享HTTP迁移
只应进入维护窗口；该自治包已经把后续EDA应用从“重画系统图”缩成一个受控renderer/applicator。

骨架收口后，继续扩充空模板或离线EDA近似源文件的边际收益低。当前收益最高的下一硬件任务回到真实MB1发送；
若用户暂时不执行外部动作，硬件线保留当前证据状态，不用芯片级设计替代缺失的供应商和实物闭环。

## 软件任务：System TTS Source Adapter 01 收口后复排

### 新增可复算事实

- `SW-TTS-SOURCE-ADAPTER-01` 已完成：第三个 `SYSTEM_TTS` 来源复用既有
  `AuthoringProductSession → FILE import bridge → FamilyWorkspace → FamilyRevision → review` 主链；
  session core/controller、FamilyWorkspace、FamilyRevision/CAS/replay、capture/prelisten和compiler均保持字节不变；
- v1只接受内容寻址、精确固定的fixture descriptor和黄金WAV SHA；provider只得到request、子AbortSignal与
  resource limits，不得到App staging path。App独占写入并见证root/file identity，导入后再次连接
  `assetId/bytes/SHA-256`，同inode同长度换字节在audit、metadata和commit前被阻断；
- provider与audit都采用supervised operation和bounded settlement。audit completion reject后必须取得精确
  `persisted=true/false`结算证明，未知状态隔离通道；真实provider仍由独立qualification registry持有；
- 确定性验收 **41/41**，连续两次报告SHA-256均为
  `d2488e26f3363e7b46d57c2475c524ce6c096c98cc8a3e754e2c77c1c967a5db`；两路独立审查最终P0=0/P1=0；
- `npm run validate:full`通过；最终文档收口后的sealed host run/source set记录在
  `docs/codex/capsules/tts-source-adapter-v1.md`，ReleaseDecision保持15 pass/0 fail/19 missing、
  `releaseReady=false`。

### 硬件收口同步

收口后再次只读复算root hardware anchor、topology和target binding，文件SHA-256分别为
`8ce718d502965bcd67e570af641a260d9b7fb9e9702940b0f04618bc9e5f64e3`、
`96431fecb220882b16745082d803e9349675802d234eb5ddf75fa197dd5f63d5`、
`ccb6efefadc6b438646c69160bc882229465b3639c130aa044a08330de35e202`，与本包runner绑定值一致：

- `BOARD_TARGET=UNRESOLVED`，HardwareSystem 425/425，18/18 interface binding仍为
  `TARGET_EVIDENCE_PENDING`；
- 无codec、storage、USB、OID event或board adapter新绑定；真实MB1/benchmark/lab/target证据状态无增量；
- 因此本包`hardwareImpact=NONE`、`offlineReady=false`，设备codec/安装/介质仍由目标板与实物门持有。

### 当前软件候选

沿用同一100分维度。TTS已完成并移出待办；硬件输入和其余候选的证据状态没有发生足以改变分项的增量，
因此保留上次可复算分数，不为制造“新排序”任意调分：

| 排名 | 软件工作包 | 分项 | 总分 | 证据判断 |
|---:|---|---|---:|---|
| 1 | `SW-AUTHORING-TASK-RECOVERY-01` | `23/17/17/9/6/6` | **78** | frozen source/commit/review任务仍主要在内存；TTS又增加provider与audit settlement。现有maintenance journal、FamilyRepository幂等/CAS和child-process恢复证据可复用，但先要冻结用户可见恢复/放弃语义 |
| 2 | `SW-DESKTOP-AUTHORING-UI-ADAPTER-01` | `27/12/12/8/5/6` | **70** | 最接近真实用户操作，但UI框架、OS permission UX与可用性基准证据仍不足，直接实现返工风险高 |
| 3 | `SW-FAMILY-WORKSPACE-LIFECYCLE-01` | `15/15/12/10/7/7` | **66** | 多库close/reopen缺口明确；首发仍只有一个家庭owner，第二真实消费者尚未出现 |
| 4 | `SW-CROSS-PROCESS-WRITER-LEASE-01` | `18/14/10/9/5/5` | **61** | 能强化本地存储，但当前仍是单进程owner，平台锁、ACL与crash lease需要单独证据 |
| 5 | production authority/keyring/replay qualification | `20/11/9/9/6/5` | **60** | 合同成熟，真实账号、OS keystore、轮换和产品事务约束仍缺 |
| 6 | `SW-DEVICE-INSTALL-COMPOSITION-01` | `18/14/8/10/5/4` | **59** | DeviceLink成熟，仍受release Snapshot、target transport/storage和实物门约束 |

### 选择

选择78分`SW-AUTHORING-TASK-RECOVERY-01`。第一步不是直接复制asset-vault journal，而是先用现有产品任务状态、
commit truth barrier、FamilyRepository幂等/CAS和恢复证据冻结：哪些状态可持久、哪些effect必须重新发起、何时只允许
放弃、如何向家长显示“素材已发布但任务未提交”。只有语义和负向矩阵闭合后，才实现最小App-local task journal
adapter。这样先解决所有FILE/CAPTURE/TTS共享的中断缺口，同时保持UI框架、provider、repository和设备端合同分离。

## HW-FIXTURE-METHOD-GAP-EVIDENCE-AUDIT-V1 收口后的最新硬件复排

本包完成了三个方法缺口的一手来源审计和可复算 source manifest：

- USB-IF 证据支持 `IF-USB-DATA` 的 revision/trace/owner-binding target-neutral skeleton；
- Micron、KIOXIA、NVM Express、SD Association 与不可访问的 JEDEC landing page 共同证明，存储掉电方法仍依赖目标存储技术、文件系统、恢复语义和物理阈值，不能冻结为 accepted method；
- NI VeriStand 与 OpenHTF primary project material 支持 control/status HIL 的 logical stimulus/observation、measurements、attachments、fault/trace 结构；物理 I/O、firmware行为和阈值仍待目标证据；
- validator `26/26`、negative selftest baseline `26/26` 加 `30/31` mutations rejected（1 benign current dependency identity drift accepted）；方法缺口决策、官方 raw snapshots、audit-time owner provenance、live semantic owner contracts unchanged。`BOARD_TARGET=UNRESOLVED`；software `hardwareImpact=NONE`。

本包从 pending 队列移除；USB 和 control/status 仅为后续 owner-review 的 skeleton，不是已接受 method。存储继续保持 pending。按当前证据，外部动作仍在所有自治方法合同之前：

| 排名 | 工作包 | 分项 | 总分 | 当前门与动作 |
|---:|---|---|---:|---|
| 1 | `HW-MB1-SEND-AND-FREEZE` | `30/20/20/10/7/9` | **96** | 人员通过现有官方入口真实发送并保存 Message-ID/确认号/FAE 工单。 |
| 2 | conditional `HW-BENCHMARK-BUY-AND-INTAKE` | `24/18/19/10/8/7` | **86** | REF2 同一待发物卖家证据门通过后才付款和到货 intake。 |
| 3 | `HW-REF2-SELLER-EVIDENCE-SEND-AND-CAPTURE` | `24/18/16/10/9/8` | **85** | 发送现成请求并归档十一项同一待发物原件。 |
| 4 | `HW-LAB-INSTRUMENT-REGISTRATION` | `18/20/15/9/8/7` | **77** | 采集 LAB1–LAB6 六槽位/七资产身份、校准和参考标准原件。 |
| 5 | `HW-FIXTURE-METHOD-CONTRACT-USB-CONTROL-HIL-V1` | `22/18/12/9/7/5` | **73** | 待稳定 lab method owner review；不能把 proposed IDs 写入 catalog，target参数/阈值仍 pending。 |
| 6 | `HW-EDA-SHARED-HTTP-LIVE-MIGRATION` | `16/20/5/10/6/7` | **64** | 只有 live EDA 成为真实前置且用户安排维护窗口时执行。 |
| 7 | `HW-FIXTURE-STORAGE-POWER-LOSS-EVIDENCE-V2` | `18/13/5/8/7/7` | **58** | 等目标存储技术、filesystem、recovery contract 和更多 primary evidence。 |
| 8 | 芯片级自研 PCB | `10/4/4/4/5/2` | **29** | 继续锁在 board/target evidence 门后，不以 EDA 填补实物缺口。 |

下一自治决策优先是后续 USB/control-status method-contract owner-review；若没有新的外部回件、实物或目标存储资料，不继续添加 chip/pin/rail/connector/layout 细节。
## `HW-EVIDENCE-CAPTURE-ADAPTER-V1` 收口后的最新硬件复排

本包关闭了四类 owner 重复归档的本地自治缺口：统一 request/profile/index 合同、四 lane route 与
ownerFragment 封闭、source/owner/request 路径和身份门、独占 staging copy、readback、hash witness、
不可变 index 与受控 rollback 已通过本机复算；当前 5 个准备 workspace 仍是只读 preflight，真实 raw、
vendor response、physical records 和 qualified lab 均未被伪造。

软件同步保持 `System TTS Source Adapter 41/41`、`hardwareImpact=NONE`、`BOARD_TARGET=UNRESOLVED`，
没有 codec、storage、USB、OID event、board adapter、BOM、测试、ReleaseGate 或 EDA transport 增量。

| 排名 | 工作包 | 分项 | 总分 | 当前动作 |
|---:|---|---|---:|---|
| 1 | `HW-MB1-SEND-AND-FREEZE` | `30/20/20/10/7/9` | **96** | 人员真实发送三份 MB1 询证并保存 Message-ID/确认号/FAE 工单 |
| 2 | conditional `HW-BENCHMARK-BUY-AND-INTAKE` | `24/18/19/10/8/7` | **86** | 仍受 REF2 同一待发物卖家原件门控，证据齐后单买并 intake |
| 3 | `HW-REF2-SELLER-EVIDENCE-SEND-AND-CAPTURE` | `24/18/16/10/9/8` | **85** | 发送现成请求并归档 11 项同一待发物原件 |
| 4 | `HW-LAB-INSTRUMENT-REGISTRATION` | `18/20/15/9/8/7` | **77** | 盘点 LAB1–LAB6 六槽位/七资产身份、校准/参考标准原件 |
| 5 | `HW-EDA-SHARED-HTTP-LIVE-MIGRATION` | `16/20/5/10/6/7` | **64** | 只在用户安排短维护窗口且 live EDA 成为前置时执行 |
| 6 | `HW-EDA-SYSTEM-SKELETON-CONTROLLED-APPLY` | `13/18/4/10/6/7` | **58** | 继续保持系统骨架；芯片/引脚/电源/连接器/布局受证据门锁定 |
| 7 | custom PCB | `10/4/4/4/5/2` | **29** | 一体板候选尚未被书面回件和两套同版实物判失格 |

收口后最高下一任务仍是真实 MB1 发送；适配器的价值是让回件、卖家原件和仪器原件先形成可审查的
不可变证据索引，而不是用本地模板替代外部事实。
## HW-REUSABLE-TEST-FIXTURE-ARCHITECTURE-V1 收口后的最新硬件排序

本包完成了稳定 fixture profile、unresolved target adapter、physical-instance/selftest placeholder 到既有 lab session/TestResult/raw evidence owner 的版本化接缝；validator 与负向 selftest 均为自治验证，不创建实物、不关闭 ReleaseGate、不改变 `BOARD_TARGET`。当前软件owner锚点和正式报告只读读取，明确硬件影响报告仍为 `hardwareImpact=NONE`，验证器不再依赖历史软件任务名。

收口验证为 validator `117/117`、selftest baseline `109/109` 加 `40/40` mutations rejected；当前报告 SHA-256 为 validation `d9633130235f735ae61a5087184c6337a4414f65431801a33fefa9a9056e05c4`、selftest `9df0d71eb489deab08ff78753d4154f57299ceda0aeaed99f8360503aa2e201e`。本包报告只留在 ignored build 目录，未产生物理或软件影响。

本包从 pending 队列移出。外部动作继续优先，排序保持：

| 排名 | 工作包 | 分数 | 当前动作 |
|---:|---|---:|---|
| 1 | `HW-MB1-SEND-AND-FREEZE` | **96** | 人员真实发送三份 MB1 询证并保存 Message-ID/确认号/FAE 工单 |
| 2 | conditional `HW-BENCHMARK-BUY-AND-INTAKE` | **86** | REF2 同一待发物原件齐全后单买并 intake |
| 3 | `HW-REF2-SELLER-EVIDENCE-SEND-AND-CAPTURE` | **85** | 发送现成请求并归档 11 项卖家原件 |
| 4 | `HW-LAB-INSTRUMENT-REGISTRATION` | **77** | 采集 LAB1–LAB6 六槽位/七资产身份、校准/参考标准原件 |
| 5 | `HW-EDA-SHARED-HTTP-LIVE-MIGRATION` | **64** | 仅在受控维护窗口且 live EDA 成为前置时执行 |
| 6 | `HW-EDA-SYSTEM-SKELETON-CONTROLLED-APPLY` | **58** | 继续保持系统骨架；芯片/引脚/电源/连接器/布局受证据门锁定 |
| 7 | 芯片级自研 PCB | **29** | 继续等待书面回件和两套同版实物，不以夹具模板替代证据 |

下一自治决策从证据中选择：若没有新的外部回件或实物，保持上述排序，不用继续添加芯片级 EDA 细节。

## HW-FIXTURE-METHOD-CONTRACT-USB-CONTROL-HIL-V1 architecture-review refinement

本次修订保持包 ID/revision `1.0.0`，只修复层间所有权与证据边界：method
adapter 只保留方法专属 pending 映射；既有 fixture adapter 继续独占五元组、
通用电气/机械、serial、calibration、qualification 与 readiness；run 绑定
显式引用 fixture adapter，并把 TestResult 的 `rawArtifacts` 保持为当前结果
所有者。现有 evidence-capture profile 没有 HIL/raw-test lane，合同明确记录
`captureRouteState=PENDING_OWNER_EXTENSION`、`laneId=null`、
`captureIndexId=null`。

该自治修订包在外部事实前不改变排序：MB1 send/freeze **96** > conditional
benchmark buy/intake **86** > REF2 seller capture **85** > lab physical
registration **77**。包完成后移出 pending；若外部事实仍未回件，下一自治候选为
受控 EDA live migration **64**，storage power-loss evidence **58** 继续等待
目标存储证据，custom PCB **29** 继续受 board/target evidence gates 约束。

## SW-AUTHORING-TASK-RECOVERY-01 收口后的最新软件复排

### 新增可复算事实

- `SW-AUTHORING-TASK-RECOVERY-01` 已完成并从 pending 队列移出。当前证据为：authoring task recovery **22/22**，报告 SHA-256 `7c9535fc585c2593f0215c6ec37dfc54c706896361db4dc68e5393d2fbc76059`；authoring product shell **33/33**，报告 SHA-256 `e4dd6694ece3acfa2bde4ca80d80701c27c1143067eafe70620cd03776d88eeb`；TTS source adapter **41/41**，报告 SHA-256 `04016c8479eb435c307418a2e8dbcbdae4e3f95d5e7dbee924884ede736293a0`；FamilyRepository memory **16/16**、atomic **16/16**、atomic boundaries **13/13**、repository boundaries **14/14**、zero-side-effect memory/atomic **9/9**，报告 SHA-256 `96433369a8bad64742c53699a259313e3fc738a2609315a3f9828312443b019f`；FamilyWorkspace **34/34**，报告 SHA-256 `094f7607beed195854f4083a1f8851b33af8fcf3bfd62295a66d913e56837254`；asset-vault recovery **70/70**，报告 SHA-256 `65c2923ada29eb98c65b2d4f83d4b7da971b4c4fb1ef588bff75b20880ecb474`；`npm run typecheck` 与 `npm run validate:books` 均通过。
- 收口合同提供可复用的 local journal、CAS、COMMITTING truth barrier、exact replay、fresh review retry、pre-durable `RESTART_SOURCE` 与 adapter/hardware `ReleaseGate`；本地存储的 parent-directory fsync、锁租约和突然断电耐久性仍是诚实限制。
- 本次硬件只读输入当前为：`docs/codex/active-task.md` SHA-256 `0d0067d081e8bea3e07a8a2b7a4fda506308fc323cdd1d150703842e8af963da`，`docs/research/hardware-software-sync-2026-08-04.md` SHA-256 `ecaf18aa8763c3f8b254e3a1a131e7d989f515e9b0a63d23fceb070aced9e373`，topology SHA-256 `96431fecb220882b16745082d803e9349675802d234eb5ddf75fa197dd5f63d5`，target-binding SHA-256 `ccb6efefadc6b438646c69160bc882229465b3639c130aa044a08330de35e202`。`targetIdentity.state=UNRESOLVED`，18/18 `interfaceBindings.state=TARGET_EVIDENCE_PENDING`，可复用 test-fixture architecture 仍是 hardware-only evidence，不创建 software interface binding；因此 `hardwareImpact=NONE`。
- TTS 原始 package seal 仍为 `d2488e26f3363e7b46d57c2475c524ce6c096c98cc8a3e754e2c77c1c967a5db`；当前回归报告可以不同，因为它绑定了有意变更的 protected authoring core/controller hashes。

### Pending 移除与分数保留

本包从 pending 队列移出。没有新证据支持任意调分，保留其余软件候选原有分项与总分：

| 排名 | 软件工作包 | 分项 | 总分 |
|---:|---|---|---:|
| 1 | `SW-DESKTOP-AUTHORING-UI-ADAPTER-01` | `27/12/12/8/5/6` | **70** |
| 2 | `SW-FAMILY-WORKSPACE-LIFECYCLE-01` | `15/15/12/10/7/7` | **66** |
| 3 | `SW-CROSS-PROCESS-WRITER-LEASE-01` | `18/14/10/9/5/5` | **61** |
| 4 | production authority/keyring/replay qualification | `20/11/9/9/6/5` | **60** |
| 5 | `SW-DEVICE-INSTALL-COMPOSITION-01` | `18/14/8/10/5/4` | **59** |

### 下一选择

选择 `SW-DESKTOP-AUTHORING-UI-ADAPTER-01`，总分 **70**。第一步是证据/只读工作：成熟产品 UX flows、当前 app-shell surface、OS permission/recovery UX 与 framework constraints；不凭猜测选择 UI framework。恢复包提供可复用 primitives 与 save/checkpoint contract；desktop composition 必须证明每一次同步用户 mutation 都已持久化，而不能依赖调用方记住临时的 ad hoc save。

## HW-FIXTURE-METHOD-GAP-EVIDENCE-AUDIT-V1 revision 1.1.0 dependency-semantics closeout

The package is accepted and removed from pending. Its validator is `26/26` and
its negative selftest is baseline `26/26` with `30/31` mutations rejected; one
benign current dependency identity drift is accepted while semantic drift is
rejected. The
repair preserves the nine raw official snapshots and all three decisions while
separating audit-time fixture/software identities from live semantic checks.
The next hardware candidates remain unchanged and external actions stay ahead:

| Rank | Candidate | Score | Next action |
|---:|---|---:|---|
| 1 | `HW-MB1-SEND-AND-FREEZE` | **96** | Human sends the prepared MB1 request and records the receipt. |
| 2 | conditional `HW-BENCHMARK-BUY-AND-INTAKE` | **86** | Buy only after the REF2 same-item evidence gate passes. |
| 3 | `HW-REF2-SELLER-EVIDENCE-SEND-AND-CAPTURE` | **85** | Send and capture the seller originals. |
| 4 | `HW-LAB-INSTRUMENT-REGISTRATION` | **77** | Capture six slots/seven asset identity and calibration originals. |
| 5 | `HW-FIXTURE-METHOD-CONTRACT-USB-CONTROL-HIL-V1` | **73** | Later owner review; proposed IDs remain unaccepted. |
| 6 | `HW-EDA-SHARED-HTTP-LIVE-MIGRATION` | **64** | Only in a controlled maintenance window. |
| 7 | `HW-FIXTURE-STORAGE-POWER-LOSS-EVIDENCE-V2` | **58** | Reopen after target storage and recovery evidence. |
| 8 | chip-level custom PCB | **29** | Remains behind board/target evidence gates. |

## HW-FIXTURE-METHOD-CONTRACT-USB-CONTROL-HIL-V1 closeout

The package freezes two target-neutral proposed contracts and removes itself
from pending. USB and control/status remain `PROPOSED_ONLY`; storage power-loss
remains pending. The architecture-review refinement keeps method adapter
fields method-scoped, preserves fixture-adapter ownership, and records the
absent HIL capture lane as `PENDING_OWNER_EXTENSION`. Contract validation is
`38/38`, SHA-256
`ced7167a1a915f75a5b46baaf47856cacef7547e826bc9be7e9c7cf6deae5c7e`;
selftest baseline is `38/38`, `42/43` mutations rejected with one benign
software task/hash progression accepted, SHA-256
`2c3834a1d9d16406977ac66c141f36165b6246d283c2d40d7ac5c02826953252`.

External ranking remains MB1 send/freeze **96** > conditional benchmark
buy/intake **86** > REF2 seller capture **85** > lab registration **77**.
The next autonomous candidates are controlled EDA migration **64**, storage
power-loss evidence **58**, and custom PCB **29**, all still behind their
evidence gates.

## HW-FIXTURE-METHOD-CONTRACT-USB-CONTROL-HIL-V1 final storage-closure closeout

The final refinement closes the field-to-storage seam without changing the
package ID/revision or any stable owner. USB and HIL run inputs are explicit
method-scoped pending slots; target-stable HIL routes remain in the
method-specific adapter; physical PIN_MAPPING/CONNECTOR/FIRMWARE_VERSION and
session/result/evidence/ReleaseGate references resolve only to existing owner
paths. HIL capture remains `PENDING_OWNER_EXTENSION`, both methods remain
`PROPOSED_ONLY`, storage remains pending, and `hardwareImpact=NONE`.

Contract validation is `38/38` (SHA-256
`c87519784da436460aae3d163b919faa33cddc150a2cc1b264b585c43b51b491`);
selftest baseline is `38/38` with `42/43` mutations rejected (one benign
software task/hash progression accepted; SHA-256
`2c3834a1d9d16406977ac66c141f36165b6246d283c2d40d7ac5c02826953252`). The
package is removed from pending. External actions remain MB1 send/freeze
**96** > conditional benchmark buy/intake **86** > REF2 seller capture **85**
> lab physical registration **77**; next autonomous choice remains controlled
EDA shared-HTTP migration **64**, with storage evidence **58** and custom PCB
**29** behind their evidence gates.

Integrated verification refresh: contract `38/38` report SHA-256
`ced7167a1a915f75a5b46baaf47856cacef7547e826bc9be7e9c7cf6deae5c7e`,
selftest baseline `38/38` with `42/43` rejected SHA-256
`2c3834a1d9d16406977ac66c141f36165b6246d283c2d40d7ac5c02826953252`;
fixture `117/117`/`40/40` and method-gap `26/26`/`30/31` remain green. The
software line is read-only at desktop report `93/93`, `hardwareImpact=NONE`,
`BOARD_TARGET=UNRESOLVED`; no software `validate:full` run is claimed.

## HW-HIL-RAW-EVIDENCE-CAPTURE-LANE-V1 closeout (2026-08-05)

This package closes the target-neutral owner-extension seam with one proposed
`HIL_RAW_TEST` lane and a zero-artifact capture-index template. It is removed
from pending after targeted validation. The previous autonomous score was
`24/19/14/9/8/8 = 82`; the score is retained as completion evidence, not as a
new pending candidate. The current evidence-capture profile still has four
lanes and no HIL adoption; all target, physical, result and ReleaseGate fields
remain pending/null.

| Rank | Work package | Components | Total | Current gate/action |
|---:|---|---|---:|---|
| 1 | `HW-MB1-SEND-AND-FREEZE` | `30/20/20/10/7/9` | **96** | Human sends the prepared request and preserves Message-ID/confirmation/FAE ticket. |
| 2 | conditional `HW-BENCHMARK-BUY-AND-INTAKE` | `24/18/19/10/8/7` | **86** | Pay only after REF2 same-item seller evidence and intake identity gates pass. |
| 3 | `HW-REF2-SELLER-EVIDENCE-SEND-AND-CAPTURE` | `24/18/16/10/9/8` | **85** | Human sends the request and captures the eleven seller originals. |
| 4 | `HW-LAB-INSTRUMENT-REGISTRATION` | `18/20/15/9/8/7` | **77** | Capture LAB1-LAB6 identity, calibration and reference originals. |
| 5 | `HW-EDA-SHARED-HTTP-LIVE-MIGRATION` | `16/20/5/10/6/7` | **64** | Highest remaining autonomous score, but blocked by an explicit controlled maintenance window. |
| 6 | `HW-FIXTURE-STORAGE-POWER-LOSS-EVIDENCE-V2` | `18/13/5/8/7/7` | **58** | Wait for target storage technology, filesystem/recovery evidence and physical thresholds. |
| 7 | chip-level custom PCB | `10/4/4/4/5/2` | **29** | Remains behind board/target evidence gates. |

Therefore MB1 remains highest overall, while no unblocked autonomous package is
currently executable: EDA migration is maintenance-gated and storage remains
evidence-gated. Do not use chip-level EDA to substitute for external or
physical facts.

## Maintenance-decoupling repair

- Removed root `package.json` from strict implementation identities. Package-owned schemas, template, README and two scripts remain byte/SHA locked.
- Added semantic npm wiring checks: exact validator/selftest commands and one ordered placement in `validate:hardware-rd` immediately after the fixture-method-contract pair.
- Targeted validator: 36/36; selftest baseline 36/36 with 41/43 rejected mutations and 2 benign cases (unrelated npm script addition and software route progression) accepted.
- Validation report SHA-256: `51f36cb346452b7db963324cc719b75d836f313ed3310d6e3c83215694d9b58b`; selftest report SHA-256: `c1eed685c414a63cb1fe1c41eea0b139373cdbec59fed97f14988de21f30827f`.
