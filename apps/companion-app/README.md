# 益米家长端：本地主机纵切

`companion-app` 现在承担第一个真实的家庭协调层组合根。当前纵切固定在
Family Alpha 的设计夹具边界内，把已经存在的稳定模块串成一条可执行链：

```text
AtomicJsonFamilyRepository
  -> FamilyRevision
  -> BuildPlan / CompileDraftProjection
  -> 全量音频预听记录
  -> fixture Confirmation Trust
  -> BuildAuthorization
  -> app-local authorization gate
  -> stable Family Alpha compiler
  -> design: Snapshot

FamilyRepository backup
  + all referenced asset bytes
  -> Family Export v1
  -> clean-directory portable restore
  -> same revision / assets / preview, distinct replica epoch

canonical local WAV import
  -> byte/SHA/codec verification
  -> target-neutral FamilyRevision authoring command
  -> FamilyRepository CAS commit/replay
  -> BuildPlan asset catalog projection
  -> AudioPlayer public port
  -> app-local pinned ffplay backend
  -> natural process exit callback
  -> explicit confirmation action
  -> existing Confirmation Trust / BuildAuthorization
  -> authorization-gated stable compiler
  -> authored design Snapshot

framework-neutral product task
  -> source registry (FILE / CAPTURE / SYSTEM_TTS)
  -> capability receipt
  -> sanitized immutable asset receipt
  -> frozen FamilyWorkspace commit command
  -> verified review receipt
  -> BuildAuthorization (device delivery remains separate)
```

## 运行

在仓库根目录执行：

确定性、静音合同门：

```powershell
npm run test:companion-host
npm run test:companion-authoring-product-shell
npm run test:companion-authoring-task-recovery
npm run test:companion-tts-source-adapter
npm run test:companion-desktop-authoring-task
```

真实主机播放器门会播放 10 段低音量 fixture 音频。默认在全部播放完成后要求操作员输入页面绑定的
确认短语；`--runner-confirm` 只用于自动证明“播放完成”和“确认动作”没有被合并，报告不会把它记作
人员听觉见证：

```powershell
npm run verify:companion-real-prelisten
npm run verify:companion-real-prelisten -- --runner-confirm --volume 20
```

把一个本地 canonical WAV 真正写入新 FamilyRevision，并对 authored preview 执行固定 ffplay、显式确认、
provider 验证和授权编译：

```powershell
npm run verify:companion-real-authored -- `
  --source hardware/evt0/family-alpha-v1/golden/assets/clip-014-1.wav `
  --transcript "这是香蕉，黄黄的，香香的。" `
  --runner-confirm --volume 20
```

同一组合根也接受显式 DirectShow 麦克风。录音先经 App-local `CapturePort` 进入 canonical import，
临时采集文件在内容寻址资产发布后即清理；后面的 revision、预听、授权和 compiler 路径与文件输入完全相同：

```powershell
npm run verify:companion-real-authored -- `
  --record-device "MIC_DEVICE" --record-seconds 3 `
  --transcript "宝贝，妈妈在这里。" `
  --runner-confirm --volume 20
```

去掉 `--runner-confirm` 后，CLI 会在全部 clip 自然结束后要求输入与 preview 绑定的确认短语。
`--binding/--clip/--language/--media-type` 只改变 composition-root 输入；revision、投影、确认和编译规则
继续由同一稳定合同/用例持有。

FamilyWorkspace 的 App-local 生命周期门：

```powershell
npm run test:family-workspace-lifecycle
# or from the repository root:
npm run test:companion-family-workspace-lifecycle
```

它使用 `family-workspace-lifecycle.json` 侧车提供确定性的 `list/create/open/reopen/close/archive/unarchive`。
`close` 只释放本进程内且已空闲的 capability；旧 capability 之后返回 `FAMILY_WORKSPACE_CLOSED`，
`reopen` 创建新的协调器。`archive/unarchive` 只做可逆元数据 CAS，不改 marker、repository、历史
revision 或 asset-vault bytes；`export/restore` 仍是内容迁移边界，不等同于 archive。跨进程 writer lease、
永久删除、DeviceLink/device install、UI framework 与 `offlineReady` 均不在本包内。

底层预听诊断命令仍可单独探测 DirectShow 和 canonical import；它会明确把结果标成未绑定 preview，
产品创作纵切使用上面的 `verify:companion-real-authored`：

```powershell
npm run verify:companion-real-prelisten -- --record-device "MIC_DEVICE" --record-seconds 3
```

实现依据分别来自 [FFplay 官方选项](https://ffmpeg.org/ffplay.html)（`-autoexit` 表示媒体播放完毕时退出、
`-nodisp` 关闭图形显示）、[FFmpeg DirectShow 设备文档](https://ffmpeg.org/ffmpeg-devices.html#dshow)
和 [Yoto 官方录音后回听流程](https://support.yotoplay.com/en_gb/how-to-create-a-playlist-from-your-own-recordings-B1piuFiXGl)。
Yoto 只提供成熟交互基准；逐 clip hash、natural-end receipt、challenge 和签名确认是益米自己的质量门。

验收报告写到：

```text
build/companion-host-validation/report.json
build/companion-prelisten-validation/report.json
build/companion-host-audio-validation/report.json
build/companion-verified-prelisten-validation/report.json
build/companion-authoring-validation/report.json
build/companion-capture-authoring-validation/report.json
build/companion-authoring-product-shell-validation/report.json
build/companion-authoring-task-recovery-validation/report.json
build/companion-tts-source-adapter-validation/report.json
build/companion-asset-vault-maintenance-validation/report.json
build/companion-asset-vault-recovery-validation/report.json
build/companion-family-workspace-validation/report.json
build/companion-family-workspace-lifecycle-validation/report.json
build/companion-desktop-authoring-task-validation/report.json
build/companion-real-prelisten/report.json
build/companion-real-authored-flow/report.json
```

## 已覆盖

- Atomic JSON 仓库显式初始化、提交、重开、CAS、epoch 与操作重放；
- 从 `FamilyRevision` 和已固定的 Alpha 目标夹具确定性构造 `BuildPlan`；
- 每个必听 clip 完成播放后才接受家长确认；
- 由现有 Confirmation Trust provider 验证证明并生成 `BuildAuthorization`；
- app 编排层先核对授权的 schema、内容身份、全部绑定和有效期，再调用稳定编译器；
- 缺失、坏身份、过期及 revision/plan/preview 错配授权均在输出父目录出现前结束；
- 成功结果保持 `design:` 身份，并停在 DeviceLink 产品安装之前。
- repository backup 与全部历史 revision 引用资产组成内容寻址的完整家庭包；
- 导出目录执行精确文件闭包、显式资源门、逐文件 SHA-256 与 `path == sha256` 约束；
- 干净目录恢复后重建相同 revision、资产和 preview，同时让恢复副本使用不同 outbox epoch；
- 同一 `assetId` 跨 revision 更新、文件篡改、路径伪装、额外文件、源/目标重叠和已有输出保护均有回归。
- 预听前重新核对普通文件、目录归属、bytes 与 SHA-256；canonical import 发布到内容寻址 vault；
- 确定性 prelisten 门以19项场景覆盖提前确认、后端错误、timeout、abort、显式 stop、缺 natural-end receipt、
  重复/陈旧 callback、哈希篡改、路径逃逸、清理屏障、解析期取消和并发播放；
- 主机音频进程门以16项场景覆盖预取消、timeout/abort 后等待 `close`、SIGKILL 升级、运行时错误、
  无重叠重试、监听器释放、录音 staging、独占发布和发布后清理状态；
- authoring 门以15项场景证明真实 canonical WAV 先发布到内容寻址 vault，再由显式 base revision 命令
  生成 target-neutral FamilyRevision、执行 CAS/精确重放、投影 BuildPlan，并走到完整预听的
  `READY_TO_CONFIRM`；陈旧头、缺 binding/clip 和坏导入 receipt 均保持 repository 零副作用；
- capture-authoring 门以12项确定性场景证明 DirectShow `CapturePort` 成功结果进入同一 import→revision→
  BuildPlan→完整预听→BuildAuthorization→Snapshot 主链；预取消、运行中取消、timeout、坏 recorder receipt、
  import 失败和 cleanup 失败均停在 revision commit 之前，临时源路径和设备名不进入 durable artifacts；
- authoring product shell 门以33项场景组合真实 FamilyWorkspace capability，覆盖FILE零权限调用、CAPTURE
  deny→grant、permission/producer/error-code私有身份隔离、metadata、command factory单飞/取消、精确commit replay、stale head、commit barrier、review拒绝/串绑与source settlement；
  产品API没有直接confirm入口，fixture review不提升`buildAuthorized`，生产authority、设备交付与`offlineReady`继续保持独立证据门；
- authoring task recovery 门以22项场景覆盖 canonical record identity、local CAS/lock、corruption quarantine、
  pre-durable source restart、PREPARING_COMMIT safe retry、COMMITTING exact replay、fresh review retry、
  base-head conflict 与 adapter/hardware ReleaseGate；详见 [Authoring Task Recovery v1](../../docs/authoring-task-recovery-v1.md)。
- desktop authoring UI adapter 门以确定性本地 journal runner 覆盖 fresh durability、sourceRequest restart、同步
  metadata/retry persistence、async settlement、canonical payload single-flight、COMMITTING truth barrier、
  restart-time adapter/head reclassification、CAS stale abandon、conflict/adapter mismatch/terminal/corruption
  attention 与 renderer privacy；组合根必须显式提供 adapter bindings，详见 [Desktop Authoring UI Adapter v1](../../docs/desktop-authoring-ui-adapter-v1.md)。
- system TTS source 门以41项场景证明第三来源只增加App-local合同、source adapter和任务facade；
  固定fixture provider→私有canonical bytes→App身份见证staging→既有FILE import bridge→FamilyWorkspace CAS→
  sanitized audit receipt；provider不获得App路径，并覆盖文本绑定、provider固定身份/隐私、输出上限、receipt
  快照、根换身/部分写入、导入后SHA重验、watchdog/迟到completion、清理证明、三阶段取消、supervised audit
  reject结算/timeout/迟到持久化隔离与single-flight；
  session core、FamilyWorkspace和11个软件/硬件保护输入前后字节一致，报告另绑定4个本包subject文件；
- asset-vault maintenance 门以21项真实文件/故障注入场景复用全部历史 FamilyRevision 引用，建立
  mark→dry-run→稳定引用租约→fresh inventory→conditional quarantine/purge；老 orphan 删除、年轻 orphan
  保留，新引用/换字节/篡改/缺失/异常条目使计划失效或阻断；quarantine rename 故障全回滚，捕获到的
  purge 中途 I/O 故障明确报告已删前缀、恢复其余对象，并允许重新规划；
- asset-vault recovery 门以70项场景把重验后的 plan/candidate identity 持久化到 canonical journal；
  六个真实子进程退出点经全新 FamilyWorkspace 启动恢复，保留连续已删前缀、回迁剩余 quarantine、复算
  fresh inventory/plan，并覆盖 journal/字节/路径/状态篡改阻断；
- verified-prelisten 用例门以5项场景证明两条主机调用链共享相同顺序：全部 natural-end 后才请求
  显式动作，随后形成 confirmation/proof/provider verification/BuildAuthorization；拒绝动作不消费 challenge；
- real-authored 主机门以10项 gate 把所选本地 WAV 贯穿 authored revision、BuildPlan、materialized preview、
  10/10 ffplay、显式确认、授权编译和最终 `design:` Snapshot，并逐字节复算被替换 clip 的编译结果；
- 主机门逐个执行固定 SHA-256 的 `ffprobe`、完整 `ffmpeg` null decode 和真实 `ffplay -autoexit`；
  只有未停止、未超时且退出码为0的同代进程生成完成事件；
- 真实 presentation 继续交给既有 schema/provider/replay 语义验证，再派生当前 BuildAuthorization。

## 当前边界

- 单一家庭 owner；
- Family Alpha golden fixtures 与本地 Atomic JSON adapter；
- fixture Ed25519 key（RFC 8032 test vector）；
- 本轮未进入 SQLite、云账号、多监护人、生产密钥或真实 USB 安装。
- `ffplay` 自然退出证明主机播放后端完成，不证明声卡未静音、操作员确实听见、点读笔声学合格或
  目标板音频链通过；这些证据在报告中分别保持为 `false`。
- `--runner-confirm` 是 fixture 显式动作；只有交互短语入口记录操作员的播放后动作，生产监护身份仍由
  production authority gate 持有。
- DirectShow adapter 已通过注入式 `CapturePort` 接入 Family authoring；确定性 fixture 已贯穿 Snapshot。
  当前真实主机报告使用本地文件，实际麦克风设备名、OS 权限和一次真实采集仍由显式主机命令形成独立证据。
- authoring 纵切已把 CLI 所选本地 WAV 写入新 FamilyRevision，并完成真实主机预听与授权 design Snapshot；
  framework-neutral产品会话现已收敛source/permission/metadata/commit/review失败语义，具体UI控件、真实OS权限
  展示、一次真实麦克风绑定和用户身份仍由平台adapter输入。CAS 失败可留下未引用的内容寻址对象，
  但不会留下部分 revision；FamilyWorkspace 已让所有 reference mutation、maintenance、export 和 restore
  共用同一 coordinator，并在 capability 暴露前执行 vault startup recovery。
- 目录发布与 maintenance journal 已证明进程退出/重启后的 namespace 恢复；父目录 fsync、跨进程 writer、
  root replacement 和目标介质真实掉电耐久保持独立实物门。

组合根只负责把本地 revision 与固定 target 输入组装成 provisional BuildPlan；
projection hash 与 BuildSubject identity 由 `tools/family-build-adapter` 的同一投影
实现最终化。这样 App 不保存第二套 draft 投影算法，后续产品壳仍可复用同一入口。
