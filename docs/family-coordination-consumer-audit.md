# 家庭协调层：权威、存储消费者与首个产品切片审计

> 审计日期：2026-08-04  
> 状态：首个 host 产品消费者、统一 FamilyWorkspace、asset-vault启动恢复、完整资产导出、真实主机预听和 Family authoring/CAS/授权 design Snapshot 纵切已实现；产品 UI、账号、生产签名、人员听觉见证、目标音频与产品数据库仍按独立证据门推进
> 上位约束：[系统构思](./system-concept.md) · [高复用、低维护架构](./reuse-maintainability.md)  
> 现有合同：[FamilyRepository v1](../hardware/evt0/family-repository-v1/) · [Confirmation Trust v1](./confirmation-trust-v1.md)

## 1. 审计问题

本轮只回答四件事：

1. 家庭可编辑事实由谁持有；
2. 本地账号、家庭库、确认权威和设备绑定是否应该是同一个身份；
3. 当前是否已经出现第二个值得提取共享应用层或引入 SQLite 的真实消费者；
4. 供应商回复等待窗口里，最小且可复用的软件产品切片是什么。

## 2. 已有依据与当前事实

| 类型 | 已有依据 | 约束 |
|---|---|---|
| `REQ` | `docs/system-concept.md` | 一个家庭所有者、本地备份/转移、无账号也可完成开箱和离线播放；复杂云账号后置 |
| `REQ` | `docs/system-concept.md` | 家长端是可编辑事实源；笔只消费编译后的只读 Snapshot |
| `CONTRACT` | `FamilyRevision v1` | 家庭 revision 只保存 target-neutral 内容事实与 asset 身份，不保存板卡、物理码、codec、路径或发布状态 |
| `CONTRACT` | `FamilyRepository v1` | revision/CAS、幂等 operation、append-only 历史、backup/restore、outbox cursor 与恢复 epoch 已冻结 |
| `CONTRACT` | `BuildPlan + BuildAuthorization` | 一次构建参数和逐构建授权不回写长期家庭事实 |
| `CONTRACT` | `Confirmation Trust v1` | 监护确认绑定一个 BuildSubject、preview、presentation、authority revision 与一次性 challenge |
| `IMPLEMENTED` | 当前仓库 | `apps/companion-app` 已成为首个产品组合根，实际调用 Atomic JSON FamilyRepository、Family build、Confirmation Trust 与 design-fixture compiler |
| `OBSERVED` | 当前仓库 | Memory/Atomic JSON 由 reference runner 消费，Family build 与 confirmation 工具消费合同；这些不是家庭产品组合根 |
| `CLOSED-HOST` | 当前执行链 | companion 的唯一 compiler dispatch 点已消费 live provider 生成的 `BuildAuthorization`；兼容 compiler 保持原接口与字节，产品 authority 仍是开放门 |
| `CLOSED-AUTHORED-HOST` | 当前执行链 | CLI 所选 canonical WAV 已贯穿新 FamilyRevision、真实 ffplay、显式动作、provider、BuildAuthorization 与 authored `design:` Snapshot；最终替换音频逐字节复算 |

结论：当前真实产品存储消费者数为 **1**，即 companion host vertical slice。测试 runner、黄金
夹具和编译工具不计作第二个真实消费者，因此共享 application package 与 SQLite 提取门尚未触发。

### 2.1 成熟产品一手证据交叉核验

| 产品/官方来源 | 已公开流程 | 对益米边界的含义 |
|---|---|---|
| [Ravensburger tiptoi Manager](https://www.ravensburger.de/de-DE/entdecken/tiptoi/tiptoi-manager) / [音频下载](https://www.ravensburger.de/de-DE/entdecken/tiptoi/tiptoi-audiodateien) | Mac/PC 下载、更新并经 USB 同步音频和固件；公开步骤未列账号环节，同步后设备离线使用 | 账号不是 USB 装载、点读与离线播放的固有前提 |
| [LeapFrog Connect](https://www.leapfrog.com/en-us/support/connect) | 标准注册流程包含 Parent Account，并通过 Connect 下载 LeapReader 内容 | 账号适合承载厂商内容权益，但不应进入 FamilyRevision 内容身份 |
| [Yoto Family Accounts](https://support.yotoplay.com/en_gb/family-accounts-HJq3OKomzx) / [自有录音](https://support.yotoplay.com/en_gb/how-to-create-a-playlist-from-your-own-recordings-B1piuFiXGl) | 支持家庭成员、多设备、App 录音与回听；内容可提前下载后离线播放 | 多成员与云库是可选控制面；“录音后回听”是值得复用的成熟交互基准 |
| [Yoto 隐私政策](https://yotoplay.com/legal/privacy-policy) | MYO 录音上传并由服务方存储处理，且有删除/清理规则 | 云库不等同用户持有的完整家庭备份；本地完整导出具有独立产品价值 |

交叉结论：账号身份、设备配对凭据、家庭内容事实与内容权益保持四个边界。首发本地家庭所有者
流程不以云账号为前提；未来账号只通过 `authorityResolver` 和云同步 adapter 接入。

### 2.2 已收口的主机数据缺口：完整家庭导出

现有 `FamilyRepository backup` 保存 repository state；revision 中的录音只保存
`assetId / assetSha256 / assetBytes`，不含音频字节。因此它只是“家庭事实备份”。该缺口现由
`Family Export v1` 在 companion 组合根收口，组合：

```text
RepositoryBackup
+ 全部被引用资产字节
+ 逐文件 size / SHA-256 清单
+ 格式版本、familyLibraryId 与导出身份
+ 干净目录恢复后 revision / asset / preview 等价验收
```

实现还要求 `path == assets/<sha256>.bin`、精确目录闭包、显式资源策略和 portable-restore
新 replica epoch；同一 `assetId` 在历史 revision 中改变字节时按 `(assetId, sha256)` 保存多个身份。
这证明了本地主机目录包的可迁移语义，不代替真实录音 UI、异常退出 staging 回收、父目录 fsync
或目标介质掉电耐久证据。

### 2.3 已收口的主机交互接缝：真实播放器回调

Yoto 官方流程给出的成熟基准是 App 录音、保存、回到录音库并回听；它不证明益米的逐 clip
签名确认语义。companion 现把两者按证据等级连接起来：canonical WAV 先复制到内容寻址 vault，
预听前重新复算路径归属、bytes 与 SHA-256；固定工具链依次执行 `ffprobe`、完整 decode 和
`ffplay -autoexit`。只有同一播放代际的进程自然退出且 code=0，才把该 clip 交给 presentation
controller 形成 `CLIP_PLAYBACK_COMPLETED`；全部 clip 完成后，独立动作才形成 `CONFIRM_ACTION`。

确定性门为19/19，主机进程生命周期门为16/16，真实主机 probe 为10/10自然结束 callback，并由既有 provider 消费 challenge、
验证 transcript/proof、派生 BuildAuthorization。主机报告明确区分完整解码、播放器自然退出、
操作员播放后动作、人员听觉见证、麦克风录音和目标设备音频；本次自动 probe 只关闭前两项和
runner 显式动作，不扩大成声学或生产身份结论。

同一顺序现由 App-local `verified-prelisten-use-case` 持有，确定性 5/5 门验证“完整播放→显式动作→
confirmation/proof→consume→BuildAuthorization”及拒绝动作不消费 challenge。静态 preview 与 authored
preview 是它的两个可执行调用链；这属于同一产品组合根内部的去重，不计作第二个存储消费者。
authored 主机报告另以10/10证明所选本地文件最终进入绑定 FamilyRevision 的 `design:` Snapshot。
DirectShow 现在只作为另一个 App-local source adapter：12/12 capture-authoring 门证明 capture→canonical
import 后继续走同一 revision、prelisten、authorization 和 compiler 路径，并证明取消、timeout、坏 receipt、
import/cleanup failure 均未产生 revision commit。它没有引入第二套家庭领域或编译语义。

### 2.4 已收口的主机资产生命周期：全历史 mark 与条件回收

内容对象早于 metadata CAS 发布，因此失败/取消可留下完整 orphan。companion 现在直接复用 Family Export 的
`collectReferencedFamilyAssets`，把 RepositoryBackup 中全部历史 revision 折叠为 digest mark set；本地 adapter
逐个复算 `assets/sha256/<digest>.wav`，dry-run 绑定引用状态、inventory、保留期和资源策略。apply 在同一
reference coordinator 的稳定租约内重做 snapshot/inventory，只有相同 plan 中的老 orphan 进入 quarantine/purge。
21/21 验收覆盖旧 revision 保护、新引用竞态、篡改/缺失/异常条目、提交前回滚、物理 purge 部分失败后的
明确前缀回执/剩余恢复/重规划，以及重复周期。其进程中断缺口由2.6的startup recovery继续收口；
多进程writer和设备端存储仍保持各自证据门。

### 2.5 已收口的产品组合接缝：FamilyWorkspace v1

`apps/companion-app/src/family-workspace/` 现在是产品路径中 repository、canonical vault、reference coordinator
与 file/capture source ports 的唯一 factory。公开对象只给 read/authoring/maintenance/transfer capability，repository、
vault、coordinator 和通用 commit 保持私有。同一路径在同一进程复用一个实例；import、authoring、maintenance apply、
complete export 与 portable restore 使用同一排他队列。

Family Export v1 的 `assets/<sha>.bin` 继续作为传输格式；workspace adoption 先调用既有 inspector，再在 staging 中
逐 digest probe 并发布为 `assets/sha256/<sha>.wav`，随后执行 portable repository restore。34/34 验收包含
GC lease/import 顺序、伪造 receipt、未标记目录隔离、distinct epoch、staging 清理、发布后 adapter 配置失败的
输出原子性与重试。当前结论仍限定为单进程 App-owned 目录。

### 2.6 已收口的维护中断恢复：Asset Vault Recovery v1

FamilyWorkspace现在要求显式、固定的`maintenanceLimits`，并在repository、capture port和公开capability初始化前
调用vault startup recovery。每个删除事务在首个`source → quarantine`移动前发布canonical journal，绑定
operation、plan、reference state、inventory、资源策略与严格有序候选；进入purge后逐项持久记录连续已删前缀。
恢复只接受可由journal与实际source/quarantine状态共同证明的连续前缀，恢复剩余对象后要求重新inventory/plan，
不会继续执行旧计划；双存、非连续缺口、未知条目、非canonical journal或字节/mtime不一致均保留现场并失败闭合。

6个真实child-process退出窗口、二次启动幂等、fresh-plan收敛与5类负例合计70/70，报告SHA-256为
`65c2923ada29eb98c65b2d4f83d4b7da971b4c4fb1ef588bff75b20880ecb474`。该证据限定为单进程、
App-owned workspace内、在已等待的文件系统调用后受控退出；跨进程writer、父目录fsync、根替换、恢复回执
持久审计和真实掉电保持独立证据门。

### 2.7 已收口的首个用户任务壳：Authoring Product Shell v1

`apps/companion-app/src/authoring/` 现以App-local纯transition core、异步用例和FamilyWorkspace adapter持有
“source→capability→immutable asset→metadata→frozen commit→verified review”任务。FILE与CAPTURE消费同一
状态机；具体文件路径、设备名、OS权限payload和capture staging只留在adapter。commit响应丢失复用原command/
operationId，stale head进入新会话冲突；产品API不暴露直接confirmation动作，最终只接收绑定revision、binding、
clip和asset的review receipt。

33/33验收使用真实FamilyWorkspace公开capability与repository CAS/replay，覆盖权限拒绝零副作用、permission/producer/error-code私有身份隔离、capture cleanup、
command factory并发单飞/取消、精确重放、commit barrier、review拒绝/串绑、adapter自主取消、取消settlement、重复事件和stale session revision。fixture receipt不提升生产授权；设备交付与
`offlineReady`继续保持独立target证据门。详见
[`Authoring Product Shell v1`](./authoring-product-shell-v1.md)。

## 3. 身份与数据权威分离

| 对象 | 唯一权威 | 稳定身份/边界 | 不进入该对象的内容 |
|---|---|---|---|
| 家庭内容库 | 本地 `FamilyRepository` | `repositoryId + familyLibraryId + revisionId` | 云账号、设备板号、物理码、发布布尔值 |
| 资产库 | 家庭本地内容 vault | `assetId + bytes + sha256` | 被舍弃 take 不进入 Snapshot；revision 不保存文件路径 |
| 一次构建计划 | Build coordinator | `buildPlanId + buildSubjectSha256` | 家庭长期编辑历史、未来 confirmation |
| 监护确认权威 | production confirmation provider | 不可变 `authorityRevisionId` + key policy | 数据库内部账号主键、明文凭据、通用长期放行 |
| 设备内容 | Snapshot compiler + ReleaseDecision | Snapshot ID、目标映射、最终音频和校验元数据 | 原始录音、照片、VoiceProfile、云凭据和编辑标签 |
| 设备安装状态 | DeviceLink/目标设备 | stage/verify/activate 事务和 active head | 家庭编辑权限和账号会话 |

`familyLibraryId` 不是账号 ID；`authorityRevisionId` 也不是“登录过就算确认”。未来即使加入
云账号，只能通过 adapter 把账号/成员关系解析为一个不可变 authority revision，再签发本次
BuildSubject 的授权。这样本地单家庭、以后多监护人和云同步不会迫使 FamilyRevision 迁移身份。

## 4. 当前消费者清点

| 消费者 | 性质 | 当前能力 | 是否计入产品存储消费者 |
|---|---|---|---|
| `tools/family-repository` | reference implementation + conformance | Memory/Atomic JSON、一致性与故障注入 | 否 |
| `tools/family-build-adapter` | 构建防腐层 | FamilyRevision/BuildPlan → CompileDraftProjection | 否；它消费 revision 合同，不拥有家庭库生命周期 |
| `tools/confirmation-trust` | host fixture/provider reference | challenge/proof/replay/authorization | 否 |
| `apps/admin-web` | 既有研发壳 | 旧 core/content API | 否 |
| `apps/companion-app` | 首个产品组合根 | repository→plan→预听证明→authorization→design Snapshot；完整导出/干净恢复；canonical import、authored CAS 与真实主机 natural-end adapter | **是；当前唯一** |

因此现在提取“跨多个产品壳共享的 application package”或直接建立 SQLite、同步服务、
复杂账号表，会把还没出现的差异提前固化。FamilyRepository 语义继续由现有单一合同所有者
持有；首个 App 只组装端口和 adapter。

## 5. 已实现决策：第一个真实产品消费者

第一个真实消费者定义为 `apps/companion-app` 内的 **host vertical slice**。它把已冻结合同串成
一条真实应用调用链，并在新的组合根关闭 `BuildAuthorization → compile` 接缝：

```text
local owner session
  → initialize/open family library
  → commit validated FamilyRevision with expected-head CAS
  → load exact revision
  → deterministic BuildPlan
  → CompileDraftProjection / preview
  → required clips presentation transcript
  → fixture Confirmation Trust proof
  → fixture BuildAuthorization
  → authorization-gated existing compiler
  → design Snapshot
```

首切片采用现有 Atomic JSON adapter 作为 EVT 主机存储，直接复用 Family build、Confirmation
Trust 和 Alpha compiler 的既有实现。授权匹配与输出副作用门局部留在 companion 组合根；兼容
compiler 继续承担已验证的 design-fixture 字节生成，不承载新的产品授权语义。Atomic JSON 只作为
主机研发 adapter，不宣称为量产数据库。

实现入口为 [`apps/companion-app`](../apps/companion-app/)，机器报告写入
`build/companion-host-validation/report.json`。基础 acceptance 为26项 gate、6项授权负例和6项导出负例；
另有19/19确定性预听门、16/16主机进程生命周期门和10/10真实主机 callback probe。Snapshot 身份保持 `design:`；人员听觉见证、
产品 authority、目标设备音频和 DeviceLink 安装均未被主机结果代替。

### 5.1 首切片包含

- 一个家庭所有者、本地库初始化、提交、重开、CAS 与 outbox/replay 语义；
- 从已提交 revision 和既有 fixture target 确定性生成 BuildPlan 与 preview；
- 记录所有 required clip 完成播放后才允许确认的 presentation transcript；
- 由 fixture provider 验证 proof，生成只绑定当前 BuildSubject 的 BuildAuthorization；
- 组合根逐字段检查 authorization 身份、BuildPlan、revision、有效期和 fixture 边界，随后才调用
  既有 compiler；
- 错配、缺失或过期授权在创建输出目录前失败，并由 acceptance 证明零副作用；
- 输出保持 `design:` Snapshot，停在真实 DeviceLink 安装门前。
- RepositoryBackup 与全部历史引用资产组成完整目录包；干净恢复复算相同 revision、资产与 preview；
- 恢复副本 epoch 与源库隔离；同 assetId 历史换字节、路径哈希、额外文件、资源门和已有输出均有负例。

### 5.2 首切片暂缓

- 云注册、手机号登录、多监护人角色和远程共享；
- SQLite、后台同步、冲突合并和跨设备自动复制；
- production signing key、密钥轮换与真实 guardian provider；
- 产品 UI 框架、录音权限交互、TTS provider、USB transport 的具体选择；
- 导出/恢复的普通用户交互、完整导入staging的进程退出回收、父目录fsync、恢复回执持久审计与真实介质掉电耐久。

这些项不是从系统删除，而是保持各自证据门，避免把账号、存储、确认和设备安装耦合成
一个巨型服务。

## 6. “第二个真实消费者”判定门

以下四项全部成立，才把共享 application port/use case 提取为独立产品包，或评估 SQLite：

1. 出现第二个独立产品组合根，而不是同一 App 的另一个页面或测试；
2. 两者都执行相同的家庭库生命周期用例；
3. 已有局部实现出现可指认的重复语义，而不只是相似命名；
4. 提取后能删除重复实现，并让两者共同跑同一 acceptance/conformance。

可能的未来消费者是桌面 USB 安装器、移动家长端或受控 build worker；它们在真正落地前
都只是候选，不用于提前设计公共包。

## 7. 首切片验收

| Gate | 证据 |
|---|---|
| `APP-FAMILY-01` | 全新目录显式 initialize；缺 marker/state 与空库区分 |
| `APP-FAMILY-02` | 提交有效 FamilyRevision，重开后 head/revision 身份一致 |
| `APP-FAMILY-03` | 同 operation 幂等；不同 operation 的 stale head 零副作用，epoch/replay 语义保持 |
| `APP-FAMILY-04` | BuildPlan 由已读 revision 和固定 fixture target 确定性派生，身份可复算 |
| `APP-FAMILY-05` | 所有 required clip 播放完成前不产生有效 confirmation/proof |
| `APP-FAMILY-06` | 完整 presentation 经 provider 验证并生成 fixture BuildAuthorization |
| `APP-FAMILY-07` | 缺失、过期或错配 revision/plan/preview/authorization 时编译输出零副作用 |
| `APP-FAMILY-08` | 只有授权编排器调用兼容 compiler；输出为 `design:` Snapshot |
| `APP-FAMILY-09` | acceptance report 明示产品 authority、生产密钥、真实 USB 与量产存储仍是开放门 |
| `APP-FAMILY-10` | `npm test`、现有三组合同回归、`validate:contracts` 与聚合 full gate同时通过 |
| `APP-FAMILY-11` | 完整包严格闭合 RepositoryBackup 与全部历史 revision 资产，目录中无未声明文件 |
| `APP-FAMILY-12` | 干净目录 portable restore 后 revision、资产和 preview 等价，源/恢复 outbox cursor 不冲突 |
| `APP-FAMILY-13` | 同一 assetId 跨 revision 更新字节时两个内容身份均可导出和恢复 |
| `APP-FAMILY-14` | 篡改、路径哈希错配、额外文件、资源超限、根目录重叠和已有输出负例保持目标零副作用 |
| `APP-FAMILY-15` | canonical local import 保持源字节身份，发布后重新核对 codec/bytes/SHA-256，内容路径由 hash 决定 |
| `APP-FAMILY-16` | 提前确认、error、timeout、abort、缺 natural-end receipt、重复和陈旧 callback 均不产生完成事件 |
| `APP-FAMILY-17` | 固定 SHA-256 的 ffprobe/ffmpeg/ffplay 对10个 preview clip 完成导入、完整解码与真实后端自然退出 |
| `APP-FAMILY-18` | 主机 presentation 由既有 provider 验证并生成 BuildAuthorization；报告不把主机结果扩大为听觉、目标声学或生产身份证据 |
| `APP-FAMILY-19` | 真实 canonical WAV import receipt 经显式 base revision 命令生成 target-neutral FamilyRevision；路径、codec 和绝对目录不进入 revision |
| `APP-FAMILY-20` | authoring commit/replay/stale CAS 与坏 receipt/缺 binding/缺 clip 保持可复算身份和 repository 零副作用；投影后完整预听到 `READY_TO_CONFIRM` |
| `APP-FAMILY-21` | verified-prelisten App-local 用例由静态/authored 两条链共用；5/5证明显式动作晚于全部 natural-end，拒绝动作不生成确认或消费 challenge |
| `APP-FAMILY-22` | CLI 所选 canonical WAV 经 authored revision、固定 ffmpeg/ffplay、显式确认、provider/BuildAuthorization 与唯一 compiler dispatch 形成 `design:` Snapshot；替换音频逐字节一致 |
| `APP-FAMILY-23` | DirectShow `CapturePort` 只拥有临时源生命周期；成功后进入同一 authored 主链，12/12覆盖取消、timeout、坏 receipt、import/cleanup failure，设备名与临时路径不进入 durable artifacts |
| `APP-FAMILY-24` | Asset Vault Maintenance 复用全部历史 revision 引用；21/21 覆盖 dry-run、保留期、稳定引用租约、计划失效、条件删除、篡改/缺失阻断、提交前回滚、部分 purge 明确回执/恢复/重规划与重复周期 |
| `APP-FAMILY-25` | FamilyWorkspace 私有创建 Atomic repository、canonical vault 与唯一 coordinator；34/34 证明 source/authoring/maintenance/export/portable adoption 共用 capability 入口及同一进程队列 |
| `APP-FAMILY-26` | canonical journal先于首个资产移动并绑定plan/reference/inventory/固定策略/候选；70/70 child-process退出与重启验收证明连续purge前缀恢复、fresh-plan、幂等启动及歧义状态失败闭合 |
| `APP-FAMILY-27` | framework-neutral authoring产品会话33/33：FILE/CAPTURE、内容寻址capability receipt、adapter异常代码归类、metadata、command factory单飞/取消、精确commit replay、stale conflict、fixture authority隔离、review receipt与source settlement均经FamilyWorkspace公开capability闭合；无直接confirm或device-ready自报入口 |

完成这个切片后再次执行软件候选收益比较。它建立的是第一个真实消费者和第一条授权编译调用链，
不自动触发 SQLite 或共享 application package；第二个消费者出现前继续复用当前合同、reference
adapter 和 conformance。`SW-FAMILY-AUTHORING-01A/01B` 与 capture adapter 已把文件/录音 import 写入
目标中立 FamilyRevision，经 CAS/replay 复用现有 BuildPlan→preview→真实预听→显式确认→授权编译链，
并输出 authored design Snapshot；asset-vault maintenance、统一 FamilyWorkspace composition与startup recovery
已关闭主机orphan生命周期、组合绕行和受控进程中断恢复。framework-neutral authoring产品壳也已以33/33
关闭首个source→permission→metadata→revision→review任务；production authority 与 DeviceLink 继续保留证据门，
硬件询证、采购和 intake 仍属外部任务。
