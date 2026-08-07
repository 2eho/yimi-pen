# Capsule: authoring-product-shell-v1

- Date: 2026-08-04
- Project: yimi-pen
- Memory ID: authoring-product-shell-v1
- Memory class: durable-fact
- Scope: companion App-local 家庭内容创作产品任务；FILE/CAPTURE source→capability→canonical asset→metadata→immutable FamilyRevision→bound review receipt。
- Evidence basis: Yoto、Ravensburger tiptoi、LeapReader、Tonies 2026-08-04 官方流程共同支持“来源/保存、元数据、回听、明确提交、设备交付/离线状态分阶段”；竞品未公开的事务、重试和设备协议继续由益米可复算合同持有，不外推为竞品事实。
- Architecture: `authoring-product-session-core.mjs`是UI/OS/fs-free纯transition owner；`authoring-product-session.mjs`只编排异步effect与settlement barrier；FILE/CAPTURE经source registry汇入`FamilyWorkspace`公开capability；repository/vault/coordinator/root保持组合根私有；review通过窄port注入，无直接`confirm()`。
- State/replay: 单调`sessionRevision`、内容寻址`stateId`、exact duplicate幂等、eventId reuse/stale revision拒绝；commit command在abortable/single-flight `COMMIT_PREPARE`后冻结，repository response-loss只重放原operation/command，stale head进入`CONFLICT`。
- Cancellation: permission/source/review/command preparation关闭时先abort并等待settlement；adapter自主abort直接成为不可重试`CANCELLED`；非abortable repository commit是关闭barrier；最终snapshot后无异步漂移。
- Data boundary: absolute path、picker/device/OS payload、adapter receipt ID、adapter error code、动态producer字段均不进入snapshot或FamilyRevision。permission公共receipt由`sessionId/attemptId/capability/status`内容寻址；异常只保留固定`AUTHORING_SESSION_<STAGE>_<CATEGORY>`；durable producer固定为`yimi-companion-authoring@1.0.0`。
- Authority boundary: bound review receipt同时绑定session/revision/binding/clip/asset/BuildPlan/preview/transcript/confirmation/authorization；`fixtureOnly=true`只令`reviewReceiptPresent=true`，`buildAuthorized`保持false。产品会话合同已闭合，生产authority仍由`PRODUCTION_CONFIRMATION_TRUST`独立证据门持有；`offlineReady`恒为false直到DeviceDelivery与目标实物receipt。
- Evidence: 真实FamilyWorkspace公开capability与真实repository CAS/replay验收33/33；报告`build/companion-authoring-product-shell-validation/report.json`，两次运行SHA-256均为`e4dd6694ece3acfa2bde4ca80d80701c27c1143067eafe70620cd03776d88eeb`；独立审查最终无P0/P1。
- Stable regressions: authoring15/15 `f4387f…f5fec`、capture12/12 `5eb3a3…a1d03`、FamilyWorkspace34/34 `094f76…37254`、maintenance21/21、recovery70/70保持；architecture637/637、typecheck、books与companion aggregate通过。
- Full validation: `npm run validate:full`通过；sealed host run `host-run:sha256:edaf1ae3e2ca57746977a7c3f4cc13d3750088e71a46b3c80bf0a51f39f1fb36`；source set 455 files / `8fae2fe2c8ba908f8c6dc9bb050f141710d22527f12fdb447d91c3de05cacf56`；ReleaseDecision `decision:sha256:07d4ae0d4e45ad126ad4d4229e191aaa3064b604327a178eb44044516996de9d`为15 pass / 0 fail / 19 missing、`releaseReady=false`。
- Protected modules: FamilyRevision/CAS/replay、capture/prelisten/Confirmation/compiler/FamilyWorkspace既有行为保持；只从原authoring use-case无语义变化提取三个validator predicate，其原15/15与下游身份保持；`packages/*/src`与硬件无写入。
- Hardware sync: full前后hardware anchor/topology/target-binding及五份关键报告hash均不变；`BOARD_TARGET=UNRESOLVED`、HardwareSystem425/425、18/18 interface bindings待target evidence；真实MB1/benchmark/lab/target receipt仍为0。无codec/storage/USB/OID event/board adapter新绑定，`hardwareImpact=NONE`。
- Failed/avoided paths: 不把fixture review解释为生产授权；不把保存、回听、授权、设备交付合成一个布尔值；不泄露adapter私有identity/diagnostic；不在第二真实产品壳前抽跨App framework；不为TTS或新UI复制Family/repository/review语义。
- Next exact step: `SW-TTS-SOURCE-ADAPTER-01`。先用一手资料冻结provider identity、在线/离线、内容权利/隐私、取消、资源限制与canonical `WAV_PCM16_16K_MONO` receipt；随后实现确定性fixture→canonical WAV→FamilyWorkspace import的第三个source adapter，要求session core与FamilyWorkspace零修改，实际provider资格化另立证据门。

## Run Audit - 2026-08-04

- Verdict: scoped package green；整体软件目标继续active。
- Rerank: TTS source adapter 81 > authoring task recovery 78 > desktop UI adapter 70 > workspace lifecycle 66 > cross-process writer lease 61 > production authority 60 > device install 59。
- Final boundary: 产品会话结构、失败/重试/隐私与fixture authority隔离已闭合；生产review adapter、真实UI/OS权限、TTS provider、DeviceDelivery与硬件target仍按各自证据门推进。
