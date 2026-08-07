# Capsule: tts-source-adapter-v1

- Date: 2026-08-04
- Project: yimi-pen
- Memory ID: tts-source-adapter-v1
- Memory class: durable-fact
- Scope: companion App-local `SYSTEM_TTS` 第三内容来源；冻结 request/provider/resource/audit 合同，以受信任确定性 fixture 证明 provider→canonical WAV→FamilyWorkspace→FamilyRevision 复用路径。
- Evidence basis: Microsoft System.Speech/SAPI 官方资料证明已安装声音枚举、WAV 输出和异步取消；Azure 官方资料证明 endpoint/region/输出格式/配额/实时数据边界；Android、Apple 官方接口证明 engine/voice identity、异步文件或 buffer 输出和停止语义；Piper 官方仓库要求 engine 与逐 voice `MODEL_CARD` 分开审查。上述仅建立候选接口事实，真实 provider 保持独立资格化门。
- Architecture: `tts-source-contract.mjs`持有 exact/versioned request、provider descriptor、single-flight resource policy、supervised provider/audit operation与内容寻址receipt；`family-workspace-tts-source-adapter.mjs`持有私有provider bytes、App独占staging、既有FILE import、cleanup和audit；`tts-authoring-task-facade.mjs`冻结合成文本并自动提交相同`system-tts` metadata。AuthoringProductSession core/controller、FamilyWorkspace、FamilyRevision/CAS/replay均零修改。
- Provider authority: v1组合根只接受显式`allowFixtureProvider=true`且descriptor ID精确匹配`SYSTEM_TTS_V1_APPROVED_FIXTURE_DESCRIPTOR`的`FIXTURE_LOCAL`；批准音频SHA-256为`b0322f22a2846117848b4dc8fd384be5f7e5d82c86f857da795206dd4ce6e66e`。任意自声明fixture、`LOCAL_SYSTEM`候选、remote/cloud类和legacy lifecycle在`start()`前失败。
- Data boundary: provider只收到request、子AbortSignal和limits，不获得staging/output path；completion只返回run/request/audio identity、bytes和codec，adapter一次性快照复制。provider cleanup receipt和sanitized audit receipt均无bytes、token、endpoint、诊断或临时路径；公开source只返回既有六字段imported asset。
- Integrity/settlement: App以root realpath+dev+ino和file dev+ino见证写入/清理；FamilyWorkspace import后再次把`assetId/bytes/SHA-256`与provider receipt连接，同inode同长度换字节会保留`importedAssetPublished=true`但阻断audit、metadata和commit。provider timeout/abort、completion迟到、discard及audit append均使用bounded settlement；audit completion reject后调用`cancelAndWait(APPEND_FAILED)`，只有精确`persisted=true/false`证明才继续或可重试，未知状态隔离对应composition。
- Acceptance: 确定性runner 41/41，连续两次报告SHA-256均为`d2488e26f3363e7b46d57c2475c524ce6c096c98cc8a3e754e2c77c1c967a5db`；覆盖成功/FamilyRevision join、descriptor固定、文本/资源/隐私负例、provider无路径、根junction、同inode换字节、getter快照、三阶段取消、watchdog/迟到completion、discard/partial-write、audit reject-before/after-persist、timeout/迟到持久化、single-flight与全部staging清理。两路独立复审最终P0=0/P1=0。
- Subject hashes: contract=`91df68336631d73fc31e68b5030113b267d675c6b77dfe0c083169d682fa0675`；adapter=`e75c2dc6ab1079f8fae9a23d9288490b44aa990a7b7bb1e9e5a04cee7dd2c103`；facade=`cec0e559c9cc6024a8513dc9fc3dfb743875cdec7d11575706e397e857c2bfa8`；runner=`4e4ef173a86a8e5f771290649f6ebf729c82dba2c128c8d77eac20831c11c2eb`。
- Stable regressions: companion aggregate通过；authoring15/15、capture12/12、Product Shell33/33 `e4dd6694…d88eeb`、maintenance21/21、recovery70/70 `65c292…cb474`、FamilyWorkspace34/34 `094f7607…37254`保持；runner绑定8个稳定软件文件和3个硬件输入文件前后字节一致。
- Full validation: 最终文档收口后`npm run validate:full`通过；architecture652/652、HardwareSystem425/425、product baseline231/231、Family/Confirmation/Snapshot/DeviceLink/Execution/Rust共同回归通过。sealed host run=`host-run:sha256:52da097b5e6cfebd55cd39a0bafb03b7d9f21ef73637ba8de8557d049230d833`；source set=460 files / `6071da381cd2c0ad79beef16ab28fad84e2dac48a60c6a497bd363eaa16587ed`；ReleaseDecision=`decision:sha256:485fc762b83e27cdd5c6b69f1733283b880aec8298021791ef68d67443ff48bd`，15 pass / 0 fail / 19 missing，`releaseReady=false`。
- Hardware sync: 收口重读硬件anchor/topology/target-binding文件SHA分别为`8ce718d502965bcd67e570af641a260d9b7fb9e9702940b0f04618bc9e5f64e3`、`96431fecb220882b16745082d803e9349675802d234eb5ddf75fa197dd5f63d5`、`ccb6efefadc6b438646c69160bc882229465b3639c130aa044a08330de35e202`；`BOARD_TARGET=UNRESOLVED`、18/18=`TARGET_EVIDENCE_PENDING`。无codec/storage/USB/OID event/board adapter新绑定，`hardwareImpact=NONE`、`offlineReady=false`。
- Remaining boundaries: 当前仅固定fixture；真实Windows/Azure/Android/Apple/Piper provider需受信qualification registry、受限worker/进程、voice/model/rights/privacy证据和真实取消/资源验收。生产host还需私有ACL/句柄相对文件操作缩小外部同账号进程TOCTOU；大输出需流式/worker内存上限。未引用的失败后已发布内容寻址资产由既有vault maintenance回收。
- Next exact step: `SW-AUTHORING-TASK-RECOVERY-01`。先冻结用户可见恢复/放弃语义、可持久状态和truth barrier；复用现有canonical journal与FamilyRepository幂等/CAS证据，再决定最小App-local task journal adapter。UI框架、生产authority、跨进程lease和设备安装继续分门。

## Run Audit - 2026-08-04

- Verdict: scoped package green；整体软件目标继续active。
- Rerank: 已完成TTS 81分项并移出待办；authoring task recovery 78 > desktop UI adapter 70 > workspace lifecycle 66 > cross-process writer lease 61 > production authority 60 > device install 59。硬件状态无变化，不改变软件顺序。
- Final boundary: 第三个内容来源已证明“新增来源只增合同/adapter/facade/fixture”，真实provider与设备离线能力仍由各自证据门持有。
