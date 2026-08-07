# Active Task

- Updated: 2026-08-04
- Status: active
- Mode: scoped-build
- Project: yimi-pen
- Memory landing policy: ask-by-default
- User goal: 本轮只负责硬件；以成熟早教点读笔为证据基线，先做出与 Gen1 目标产品相同质量、功能和架构的单件样机，并把整机硬件架构做成高复用、低维护、越开发越简单；采购从批发改成单买，样机通过后才做批量供应商询价。
- Current responsibility boundary: 当前用户已显式恢复硬件写入专属路线并要求双线并进。只写真实 OID、同版一体主板、供电、存储、音频/声学、结构、嘉立创EDA、采购、来料与实物/HIL证据；每个硬件包启动、收口和复排只读同步软件已验收变化，把影响收敛到版本化 interface/target-binding/adapter/test/ReleaseGate；软件源码和软件 owner 记忆不由本任务改写。
- Touched modules: `docs/hardware-gen1-p0.md`, EVT-0 procurement/OID/tooling/EDA research, `hardware/evt0/eda-system-skeleton-v1`, hardware validation/generator scripts, `hardware/tests`, `hardware/tools`, root dev-tool locks/scripts, hardware/OID documentation indexes, firmware documentation, BOM lock ledger, and hardware project memory; existing application packages remain protected.
- Policy scope: Gen1 EVT-0 production-equivalent single-unit sample, real OID input, target PCB/BOM/firmware, internal battery, target enclosure/acoustics, single-unit procurement and full acceptance.
- ExecutionPolicy: latest Sol/Luna global orchestration; Sol plans/integrates/reviews/final-accepts and a persistent Luna/Max worker performs repository work
- ExecutionPolicy source: latest user-provided Sol/Luna global orchestration
- Execution protocol skills: Sol/Luna orchestration with Lite Demo memory-only routing
- Lite Demo role: memory-only
- Scope: Mature-product benchmark; retail single-buy of a current integrated point-reading mainboard/OID kit; local lookup/storage/audio; battery/charge path; target controls/status; target-form enclosure; measurable product-quality gates; same-version custom mainboard only after current integrated boards fail; bulk RFQ only after EVT-0 passes.
- Last approved route: `target OID code/media -> board-matched OID head -> current integrated mainboard -> target storage/audio/power/controls -> target speaker/enclosure`; freeze the same board/revision for EVT-0 and volume. Use the ESP32-S3 custom board stack only as a gated fallback branch.
- Equivalence rule: DIY means self-integration at single-unit quantities only. Physical code, optical head, PCB/BOM, firmware, content path, battery, acoustics, enclosure targets and acceptance thresholds stay the same as the target product.
- Interruption risk: High; component evidence, mechanical locks, PCB, firmware and physical validation span multiple phases.
- Activation packet: Treat the current milestone as `Gen1 EVT-0`, not a low-fidelity P0. First buy two same-revision current integrated mainboard/OID kits, freeze `BOM-REV-A`, then build the same board and target-form pen that will be quoted for volume.
- Selected owner routes: `hardware-p0` -> this file.
- Mandatory guard owners: this file.
- Allowed changes: EVT-0 hardware/research documentation, target firmware under a new `firmware/gen1-evt0/` boundary once the OID protocol is known, procurement artifacts, documentation indexes, and project memory.
- Stable behavior: Existing simulator, content format, TTS, architecture documents and package APIs remain unchanged during hardware execution.
- 稳定模块保护判断: 当前任务没有触碰稳定应用代码的证据；先完成真实 OID、目标主板、电源、声学和结构闭环。
- Memory hygiene: The product-equivalence correction is task-local but explicit and controlling for Gen1 EVT-0; it replaces the earlier revisable YimiDot route.
- Artifact discipline: Reuse existing mature-product research; every purchased board/component records exact MPN/revision/source/lot and document hashes; marketing generation labels such as “第四代” stay untrusted until mapped to board/head MPN and quantitative differences; bulk quotes reference the same BOM revision.
- Encoding check: UTF-8 for Chinese Markdown; run mojibake, link and table checks after edits.
- Pressure signals: Do not trade product equivalence for a faster visual-code demo or development-board milestone.
- Rejected approaches: Test-infrastructure-first roadmap; supplier/bulk-RFQ-first procurement; YimiDot/QR/AprilTag as the main point-read input; XIAO/OpenMV or stacked development boards inside the sample; drawing a custom ESP32 board before surveying current integrated boards; external power bank/computer/phone in the accepted flow; donor parts without traceable future supply; cloud-dependent tap path.
 - Current step: `HW-HIL-RAW-EVIDENCE-CAPTURE-LANE-V1` revision `1.0.0` completed: one proposed `HIL_RAW_TEST` lane, strict pending capture-index provenance, exact USB/control-status method refs, existing TestResult.rawArtifacts ownership, and no adoption of the current four-lane evidence-capture profile. Validator `36/36`; selftest baseline `36/36` with `41/43` mutations rejected and two intentional benign cases accepted (unrelated npm script addition and software progression); `BOARD_TARGET=UNRESOLVED`, hardwareImpact=NONE.
- Completed: Evidence-graded comparison of 小鸡球球、宝贝 JoJo and 讯飞; production-equivalent EVT-0 contract; optical/print evidence matrix; user teardown/mainboard photo analysis; Ztron official scheme review; public “fourth-generation OID” terminology search; removal of the rejected YimiDot implementation draft; CLI/MCP/tooling survey; Phase A toolchain; `HW-EVIDENCE-REFRESH-01` (11/11); `HW-EDA-BRIDGE-01`; `HW-EDA-SINGLETON-INSPECT-01`; 三份2026-08-04采购/复用/验证审计；`HW-LAB-BASELINE`; `HW-MB1-VENDOR-EVIDENCE-V1`; `HW-BOM-REVISION-V1`; `HW-INTAKE-SAMPLE-IDENTITY-V2`; HardwareSystem全影响映射425/425；`HW-MB1-OUTBOUND-BUNDLE-V1`（3 templates，4/4负向门，PREPARED_NOT_SENT）；`HW-MB1-CONTACT-CHANNEL-VERIFY-01`（4/4官方来源）；`HW-MB1-CONTACT-RECEIPT-V1`（16/16，隔离3/3，真实records 0）；`HW-MB1-SEND-PREFLIGHT-01`（3工作区×25/25，隔离4/4，真实submitted 0）；`HW-BENCHMARK-SKU-EVIDENCE-01`及独立follow-up（REF1售罄、REF2待G4/446637同框、REF3替换）；`HW-BENCHMARK-SELLER-EVIDENCE-V1`（1 profile/11 gates，20/20 + 9/9，真实raw/records/complete 0）；`HW-LAB-INSTRUMENT-REGISTRATION-V1`；`HW-LAB-REGISTRATION-CAPTURE-V1`（9方法/6槽位/7资产，178 checks，准备层3/3，真实records 0）；`HW-EDA-SHARED-HTTP-DESIGN`及隔离探针10/10；硬件/软件双线同步门；`HW-EDA-SHARED-HTTP-POC`（隔离双session/两cycle、31/31 + 20/20、live保护态零变化）；`HW-EDA-SYSTEM-SKELETON-V1`（12/36/18投影、3确定性工件、26/26独立验证、20/20负向门、原生EDA输出0）。
- Evidence: `docs/hardware-gen1-p0.md`, `docs/research/gen1-evt0-single-buy.md`, `docs/research/gen1-mb1-prepay-pack.md`, `docs/research/benchmark-sku-evidence-2026-08-04.md`, `docs/research/benchmark-proof-followup-2026-08-04.md`, `docs/research/benchmark-seller-evidence-v1-2026-08-04.md`, `docs/research/mb1-contact-channel-integration-2026-08-04.md`, `docs/research/vendor-contact-receipts-v1-2026-08-04.md`, `docs/research/vendor-contact-receipts-independent-review-2026-08-04.md`, `docs/research/mb1-send-preflight-2026-08-04.md`, `docs/research/hardware-software-sync-2026-08-04.md`, `docs/research/hardware-lab-instrument-registration-2026-08-04.md`, `docs/research/hardware-lab-registration-capture-v1-2026-08-04.md`, `docs/research/jlceda-shared-transport-design-2026-08-04.md`, `docs/research/jlceda-shared-http-poc-2026-08-04.md`, `docs/research/eda-system-skeleton-v1-2026-08-04.md`, three `hardware-*-audit-2026-08-04.md` reports, `hardware/evt0/eda-shared-http-poc-v1/`, `hardware/evt0/eda-system-skeleton-v1/`, `hardware/evt0/benchmark-seller-evidence-v1/`, `hardware/evt0/vendor-contact-receipts-v1/`, `hardware/evt0/vendor-evidence-v1/`, `hardware/evt0/bom-revisions/`, `hardware/evt0/intake-v1/`, `hardware/evt0/lab-v1/`, `hardware/evt0/purchase-plan.csv`, `hardware/tools/phase-a-toolchain.lock.json`, `scripts/check-vendor-contact-send-readiness.mjs`, `scripts/test-vendor-contact-send-readiness.mjs`, `scripts/generate-eda-system-skeleton.mjs`, `scripts/validate-eda-system-skeleton.mjs`, `scripts/test-eda-system-skeleton.mjs`, and generated reports under `build/`.
- Evidence added for this package: `hardware/evt0/evidence-capture-v1/`, `scripts/capture-hardware-evidence.mjs`, `scripts/validate-hardware-evidence-capture.mjs`, `scripts/test-hardware-evidence-capture.mjs`, `docs/research/hardware-evidence-capture-adapter-v1-2026-08-04.md`, `build/hardware-evidence-capture-validation.json`, and `build/hardware-evidence-capture-selftest.json`.
- Next exact step: external evidence remains ahead—send/freeze MB1 (96), conditionally buy/intake benchmark (86), send/capture REF2 seller evidence (85), and register lab physical assets (77). The HIL raw-evidence lane is removed from pending; do not adopt it into the existing profile without owner review, and do not add chip-level EDA.
- In-package ranking (fixed 30/20/20/10/10/10 model): `HW-MB1-SEND-AND-FREEZE` 96 > conditional `HW-BENCHMARK-BUY-AND-INTAKE` 86 > `HW-REF2-SELLER-EVIDENCE-SEND-AND-CAPTURE` 85 > `HW-LAB-INSTRUMENT-REGISTRATION` 77 > `HW-EDA-SHARED-HTTP-LIVE-MIGRATION` 64 > `HW-FIXTURE-STORAGE-POWER-LOSS-EVIDENCE-V2` 58 > chip-level custom PCB 29. 外部动作等待真实回件/实物；target/physical fields remain pending。
- Validation gates: fixture targeted `117/117`，selftest `109/109` + `40/40`；method-gap revision `1.1.0` `26/26` + `30/31`（1 benign current-identity drift accepted）；HardwareSystem 425/425、EDA System Skeleton 26/26 + selftest 20/20、intake 216/216、Benchmark Seller 20/20 + 9/9、Lab 178 + 3/3、Vendor outbound 3 + 4/4、Contact Receipt 16/16 + 3/3、Vendor Evidence 18/18、BOM 86/86、hardware pytest 1/1、typecheck、books、eda:doctor 均通过。Physical records、target receipts均为0；完成仍需真实OID、同版目标主板/固件、目标电池/外壳、两只头×两批印刷样和全部功能/可靠性门。
- Validation addition: `validate:hardware-evidence-capture` 66/66、`test:hardware-evidence-capture` 46/46；四 owner schema/route/fragment、五个准备 workspace 只读 preflight、已有 index/实现身份与 `BOARD_TARGET=UNRESOLVED` 均通过；canonical index commit race 由 `indexWritten` witness 保护。`validate:hardware-rd` 已接入该 validator 和 selftest。
- Regression guards: Do not introduce commercial content compatibility claims; cached tap-to-first-audio remains `<200ms`; installed content remains fully offline.
- Rollback/backups: Keep the bulk RFQ and earlier supplier research as deferred artifacts; use Git diff as the work-unit rollback boundary.
- Do not touch: `packages/core`, `packages/audio`, `packages/content`, `packages/protocol`, app runtime code, or existing user changes outside the hardware task.
- Resume instruction: Read this file, `docs/hardware-gen1-p0.md`, `docs/research/gen1-evt0-single-buy.md`, `docs/research/eda-system-skeleton-v1-2026-08-04.md`, `hardware/evt0/eda-system-skeleton-v1/README.md`, and `hardware/tools/phase-a-toolchain.lock.json`; continue from `Next exact step` and re-read the software owner anchor before reranking.
- Route check: `hardware-p0` remains the owner alias; its active meaning is now production-equivalent EVT-0 built from singly purchased target parts.
- `HW-EVIDENCE-CAPTURE-ADAPTER-V1` closeout: validator `66/66` -> `build/hardware-evidence-capture-validation.json`; selftest `46/46` -> `build/hardware-evidence-capture-selftest.json`; five prepared workspaces remain read-only preflight, real raw/response/physical records remain zero.
- Latest hardware rerank: MB1 send/freeze 96 > conditional benchmark buy/intake 86 > REF2 seller capture 85 > lab registration 77 > EDA live migration 64 > storage evidence 58 > custom PCB 29. HIL raw-evidence capture lane score 82 is completed and removed from pending; highest overall remains MB1, while EDA is maintenance-gated. Do not fill BOARD_TARGET or the five-tuple from templates.

## User Requirements

- RQ-HW-001: status=requirement-owner; source=current user instruction; scope=current hardware route; instruction=本轮助手只负责硬件部分，所有硬件选型、EDA、采购、结构、供电、声学、OID 和实物验证必须沿证据链推进；软件/应用工作保持现状；owners=this file; mandatory=this file; conflict=none
- RQ-HW-002: status=acceptance-gate; source=current user instruction; scope=hardware architecture and sequencing; instruction=整机硬件架构必须高复用、低维护成本、方便后续开发且新增工作越来越简单；成熟早教点读笔的官方资料、可追溯实物和可复算测量优先，未知项保留证据缺口；每个硬件工作包收口后重新比较候选收益再选下一步；owners=this file; mandatory=this file; conflict=none
- RQ-HW-003: status=acceptance-gate; source=latest user objective; scope=board and OID target binding; instruction=BOARD_TARGET 在两套同版实物、供应商书面资料和完整 BOARD_MPN/PCB_REV/HEAD_MPN/HEAD_REV/FW_VERSION 五元组通过前保持 UNRESOLVED；芯片级EDA及板相关采购保持证据门锁定；owners=this file; mandatory=this file; conflict=none
- RQ-HW-004: status=execution-protocol; source=latest user objective; scope=current multi-agent work; instruction=Sol 负责规划、集成、review和final acceptance；至少一个 persistent Luna/Max worker performs actual repository work even when sequential；最多三个独立worker；无并行收益时不强行拆分；owners=this file; mandatory=this file; conflict=none
- RQ-HW-005: status=execution-protocol; source=latest user clarification; scope=hardware/software parallel coordination; instruction=双线并进采用隔离写入、同步读取：本任务只写硬件，但每个硬件包启动、收口和收益复排必须读取软件线已验收增量；影响仅经版本化interface、target-binding、adapter、test或ReleaseGate进入硬件，不改软件源码与软件owner记忆；owners=this file; mandatory=this file; conflict=none

## HW-REUSABLE-TEST-FIXTURE-ARCHITECTURE-V1（已收口）

- Package state: completed；只写硬件夹具架构、硬件验证脚本、硬件研究/同步/排序和本硬件记忆锚点；不写软件源码或软件owner记忆。
- Objective: 建立 `stable fixture profile -> target adapter -> physical fixture instance/selftest -> existing lab session/TestResult/raw evidence owners` 的严格版本化接缝。
- Read-only inputs: `hardware/evt0/hardware-system-v1/topology.json`、`target-binding.json`、`lab-v1`、`test-result-v1`、`release-gates-v1`、`evidence-capture-v1`、`docs/research/hardware-reusable-test-fixture-evidence-audit-2026-08-04.md`、`docs/research/hardware-software-sync-2026-08-04.md` 和软件owner锚点。
- Protection: 稳定拓扑/target-binding/lab/method/TestResult/evidence-capture/ReleaseGate/EDA/软件/固件/owner-record保持不改；`BOARD_TARGET=UNRESOLVED`；模板、fixture-only selftest 和 synthetic evidence 不提升物理事实、目标状态或ReleaseGate。
- Required package: `hardware/evt0/test-fixture-v1/` 的四份strict schema、四份deterministic JSON/template、README，以及 `scripts/validate-hardware-test-fixture.mjs`、`scripts/test-hardware-test-fixture.mjs`；只在允许路径更新package scripts、硬件文档/同步/排序和本硬件memory。
- Coverage rule: 八个capability ID固定；七个operational family精确覆盖topology的18个interface；`IF-USB-DATA`无专用method/instrument slot，存储掉电耐久无专用method，control/status无专用method，必须显式保留缺口。
- Target rule: adapter template、instance template、selftest均保持pending/template；五元组、目标电压/电流、pin、connector、pogo、机械具体值、serial/calibration/qualification/physical-ready保持空/空集/null。
- Current software read-only delta: parent anchor `docs/codex/tasks/system-product-rd/active-task.md` SHA-256 `3161603ce8d7e59134b6b0ec7b7339a7e2d27573aa1c94508ada29d2fcc1198a`; desktop child anchor `docs/codex/tasks/desktop-authoring-ui-adapter/active-task.md` SHA-256 `2264078407a2afefe78b09ab4fadd04ac14f676383b5d39fd2990946d4a5e006`; accepted formal report 22/22 SHA-256 `7c9535fc585c2593f0215c6ec37dfc54c706896361db4dc68e5393d2fbc76059`; current explicit hardware-impact report SHA-256 `7d6cb6dd3b4163920af212d7a88e1f8c8cda6e9aeb3e428f499c7e755e1b7202`. Its live boundaries are `hardwareImpact=NONE`, `BOARD_TARGET=UNRESOLVED`, `sessionCoreModified=false`, `familyWorkspaceModified=false`, `productionProviderQualified=false`, `offlineReady=false`; no codec/storage/USB/OID/control-status/power/structure new requirement.
- Current next hardware actions after this package: `HW-MB1-SEND-AND-FREEZE` 96；conditional `HW-BENCHMARK-BUY-AND-INTAKE` 86；`HW-REF2-SELLER-EVIDENCE-SEND-AND-CAPTURE` 85；`HW-LAB-INSTRUMENT-REGISTRATION` 77。外部动作仍优先，禁止用芯片级EDA替代真实证据。
- Verification outputs: `build/hardware-test-fixture-validation.json` and `build/hardware-test-fixture-selftest.json` are ignored build reports only; no stage/commit.
- Closeout evidence: targeted validator `117/117`; negative selftest baseline `109/109` and `40/40` mutations rejected. Current report SHA-256: validation `d9633130235f735ae61a5087184c6337a4414f65431801a33fefa9a9056e05c4`; selftest `9df0d71eb489deab08ff78753d4154f57299ceda0aeaed99f8360503aa2e201e`. The validator records current anchor and formal-report identities without requiring historical software task text.
- Canonical topology identity: `canonicalSha256(topologyHashInput(topology))` with `topologyId` omitted; canonical `98a87a1de9ee8dfa52ec68ebd00afbbf23fa3c18e0c2a75e34ba09da4a9c4e5f`; raw file SHA remains separate provenance. No physical fixture, target binding, ReleaseGate closure, software change, stage, or commit occurred.

## HW-FIXTURE-METHOD-CONTRACT-USB-CONTROL-HIL-V1 architecture-review refinement（已收口）

- Method adapter is now method-scoped and contains only `METHOD_ADAPTER`
  pending/null mappings. The accepted fixture adapter remains the sole owner
  of the board/head/firmware tuple, generic target/electrical/mechanical facts,
  physical readiness, serial, calibration and qualification.
- `fieldOwnership` resolves every source-derived phase field exactly once to
  `METHOD_ADAPTER`, `RUN_BINDING`, `EXISTING_FIXTURE_ADAPTER`, or
  `OWNER_REFERENCE`; `PIN_MAPPING` is independently scoped per method. The run
  explicitly references `EVT0-TARGET-ADAPTER-TEMPLATE` by path/id/revision and
  keeps its binding ID null.
- The current evidence-capture profile has no HIL/raw-test lane. Run and owner
  projection state `captureRouteState=PENDING_OWNER_EXTENSION`, `laneId=null`,
  and `captureIndexId=null`; `TestResult.rawArtifacts` remains the current raw
  artifact owner.
- Software was read-only: accepted desktop report
  `build/companion-desktop-authoring-task-validation/report.json` is currently
  93/93, SHA-256
  `bc28adad4b4a27ade9ef573fc1a27abf8ddc8422a4d4e30e0e5a846bd92b9b24`, with
  `hardwareImpact=NONE` and `boardTarget=UNRESOLVED`. Current parent/child
  anchor hashes are `0efb93463bc6b2a405acaa8d9e50d8742f35d2a6ff426e9cd721e2e4b8bbb6a2`
  and `3d88156f5c97c100132c0d487dc7948ec613aa56e39b7698afcef0405814edd7`;
  explicit impact report SHA-256 is
  `f3f9dad07c7c710fd6bd03553c03e062ac4ad135522839b2bf510d52819708f0` and
  remains all-NONE/unresolved.
- Refinement validation: `38/38`, SHA-256
  `ced7167a1a915f75a5b46baaf47856cacef7547e826bc9be7e9c7cf6deae5c7e`;
  selftest baseline `38/38`, `42/43` mutations rejected with one benign
  software task/hash progression accepted, SHA-256
  `2c3834a1d9d16406977ac66c141f36165b6246d283c2d40d7ac5c02826953252`.
- Package remains `PROPOSED_ONLY`, storage remains pending, effects remain
  `NONE`, `BOARD_TARGET=UNRESOLVED`, and no stable owner or software file was
  edited. External ranking remains MB1 96 > conditional benchmark 86 > REF2
  85 > lab registration 77; next autonomous candidates remain controlled EDA
  migration 64, storage evidence 58, and custom PCB 29.

## HW-FIXTURE-METHOD-GAP-EVIDENCE-AUDIT-V1（已收口）

- Package state: completed；先写入并读取 ignored capsule `build/luna-fixture-method-gap-audit/phase-capsule.md`，确认 prior fixture V1 validator `117/117`、selftest baseline `109/109` 加 `40/40` rejected mutations、canonical topology hash `98a87a1de9ee8dfa52ec68ebd00afbbf23fa3c18e0c2a75e34ba09da4a9c4e5f`、`BOARD_TARGET=UNRESOLVED` 和 software read-only。
- Scope: 只新增 `hardware/evt0/method-gap-evidence-v1/` source manifest/schema/official raw snapshots/README、该包 validator/selftest、package scripts、hardware/research/sync/ranking 与本硬件 memory；stable lab method catalog、accepted fixture、topology/target-binding、TestResult、ReleaseGate、evidence-capture、EDA、firmware、software source 和 software-owner memory 均为只读。
- Evidence decisions: `GAP-IF-USB-DATA-METHOD` -> `FREEZE_TARGET_NEUTRAL_SKELETON` (later package score 74); `GAP-IF-STORAGE-POWER-LOSS-METHOD` -> `KEEP_PENDING_MORE_PRIMARY_EVIDENCE` (58); `GAP-CONTROL-STATUS-METHOD` -> `FREEZE_TARGET_NEUTRAL_SKELETON` (72)。Proposed IDs `PROPOSED-USB-DATA-OBSERVATION-001`、`PROPOSED-STORAGE-POWER-LOSS-DURABILITY-001`、`PROPOSED-CONTROL-STATUS-HIL-001` remain `PROPOSED_ONLY`。
- Source register: 9 captured official/primary sources, 1 explicit inaccessible JEDEC official landing (HTTP 403), all URL/publisher/title/time/version-or-date/status/content-type/bytes/SHA-256/raw-path/claim-boundary records are deterministic and rechecked.
- Boundary: all target/storage/firmware-specific parameters, physical thresholds, USB mode/class/identity/endpoint/framing, storage recovery rules, HIL physical I/O/debug/levels/timing, qualification and physical evidence remain pending; effects are `NONE`; no ReleaseGate or target promotion is possible.
- Software read-only delta: parent/desktop anchors are read without modification; the accepted formal report remains an audit-time 22/22 input and the current explicit hardware-impact report reports `hardwareImpact=NONE`, `BOARD_TARGET=UNRESOLVED`, `sessionCoreModified=false`, `familyWorkspaceModified=false`, `productionProviderQualified=false`, `offlineReady=false`. Current software progress may advance without changing the canonical method-gap manifest.
- Validation: package validator `26/26`, report SHA-256 `bd7664f45025362c88f8846ad1de338058cdd51440983dabd76004ecb98254d7`; negative selftest baseline `26/26`, `30/31` mutations rejected with one benign current-identity drift accepted, report SHA-256 `b9d9f88cd61901006749b59b413fcd7609ac2d69f76d8d6b2640ac47b7e78a44`. Reports are ignored build outputs only.
- Ranking: package removed from pending. Next external actions remain MB1 send/freeze 96, conditional benchmark buy/intake 86, REF2 seller capture 85 and lab physical registration 77; later USB/control method-contract owner review 73, EDA shared HTTP live migration 64, storage power-loss evidence V2 58, custom PCB 29. Do not replace external evidence with chip-level EDA.

## HW-FIXTURE-METHOD-CONTRACT-USB-CONTROL-HIL-V1（已收口）

- Package state: completed, revision `1.0.0`; exactly two target-neutral
  contracts are frozen as `PROPOSED_ONLY`: USB observation and control/status
  HIL. Storage power-loss remains outside this package and pending primary
  evidence.
- Architecture: stable contract -> method-scoped adapter -> run binding plus
  existing fixture adapter -> lab/TestResult/raw-artifact owner -> evidence-
  capture/ReleaseGate owners. Method fields are only `METHOD_ADAPTER`
  pending/null mappings; generic target facts remain solely in the accepted
  fixture adapter. HIL evidence capture is explicitly
  `PENDING_OWNER_EXTENSION` with null lane/capture IDs.
- Software closeout is read-only: desktop adapter complete, parent next route
  `SW-FAMILY-WORKSPACE-LIFECYCLE-01`, `hardwareImpact=NONE`,
  `BOARD_TARGET=UNRESOLVED`; no software task/hash is a validity gate.
- Validation reports are ignored build outputs: refinement contract `38/38`,
  SHA-256 `ced7167a1a915f75a5b46baaf47856cacef7547e826bc9be7e9c7cf6deae5c7e`;
  selftest baseline `38/38` with `42/43` mutations rejected and one benign
  software task/hash progression accepted, SHA-256
  `2c3834a1d9d16406977ac66c141f36165b6246d283c2d40d7ac5c02826953252`.
  No method catalog, instrument, target, physical, firmware, EDA, BOM,
  ReleaseGate or software owner was modified.
- Ranking after removal: MB1 send/freeze 96 > conditional benchmark 86 > REF2
  seller capture 85 > lab registration 77 > controlled EDA migration 64 >
  storage evidence 58 > custom PCB 29.

## HW-FIXTURE-METHOD-CONTRACT-USB-CONTROL-HIL-V1 final field-storage closure（当前）

- The revision `1.0.0` seam now proves that each phase field has exactly one
  storage owner: method-specific adapter, method-scoped pending run input,
  direct run reference, accepted fixture-adapter path, or existing owner
  reference. USB inputs are `CABLE_OR_FIXTURE_ID`/`PAYLOAD_SET`; HIL inputs are
  `FAULT_MODEL`/`EXPECTED_SEQUENCE`/`MEASUREMENT_SET`/
  `ACCEPTANCE_PREDICATES`. Physical `PIN_MAPPING` remains fixture-owned.
- Final contract validator: `38/38`, SHA-256
  `c87519784da436460aae3d163b919faa33cddc150a2cc1b264b585c43b51b491`;
  selftest baseline `38/38`, `42/43` rejected (one benign software
  task/hash progression accepted), SHA-256
  `2c3834a1d9d16406977ac66c141f36165b6246d283c2d40d7ac5c02826953252`.
- Fixture and method-gap evidence remain green at `117/117` + `40/40` and
  `26/26` + `30/31`; report hashes are recorded in the hardware research and
  are ignored outputs only. HIL capture remains pending, storage remains
  `KEEP_PENDING_MORE_PRIMARY_EVIDENCE`, effects remain `NONE`.
- Current software is read-only: desktop report `93/93`, parent route
  `SW-FAMILY-WORKSPACE-LIFECYCLE-01`, `hardwareImpact=NONE`,
  `BOARD_TARGET=UNRESOLVED`; no software `validate:full` claim. External
  ranking remains MB1 `96` > benchmark `86` > REF2 `85` > lab `77`; next
  autonomous candidate is controlled EDA shared-HTTP migration `64`, with
  storage `58` and custom PCB `29` evidence-gated. No stage/commit/push.

## Integrated verification refresh（当前只读状态）

- The latest read-only desktop report is `93/93`, SHA-256
  `bc28adad4b4a27ade9ef573fc1a27abf8ddc8422a4d4e30e0e5a846bd92b9b24`;
  parent/child anchors are `0efb93463bc6b2a405acaa8d9e50d8742f35d2a6ff426e9cd721e2e4b8bbb6a2`
  and `3d88156f5c97c100132c0d487dc7948ec613aa56e39b7698afcef0405814edd7`;
  explicit impact report SHA-256 is
  `f3f9dad07c7c710fd6bd03553c03e062ac4ad135522839b2bf510d52819708f0`.
  Semantics remain `hardwareImpact=NONE`, `BOARD_TARGET=UNRESOLVED`,
  `sessionCoreModified=false`, `familyWorkspaceModified=false`,
  `productionProviderQualified=false`, and `offlineReady=false`; no software
  `validate:full` claim is made.
- Current ignored package report hashes are contract validation
  `ced7167a1a915f75a5b46baaf47856cacef7547e826bc9be7e9c7cf6deae5c7e`,
  contract selftest `2c3834a1d9d16406977ac66c141f36165b6246d283c2d40d7ac5c02826953252`,
  fixture validation `d9633130235f735ae61a5087184c6337a4414f65431801a33fefa9a9056e05c4`,
  fixture selftest `9df0d71eb489deab08ff78753d4154f57299ceda0aeaed99f8360503aa2e201e`,
  method-gap validation `bd7664f45025362c88f8846ad1de338058cdd51440983dabd76004ecb98254d7`,
  method-gap selftest `b9d9f88cd61901006749b59b413fcd7609ac2d69f76d8d6b2640ac47b7e78a44`.


## HW-HIL-RAW-EVIDENCE-CAPTURE-LANE-V1 closeout

- Package `HW-HIL-RAW-EVIDENCE-CAPTURE-LANE-V1` revision `1.0.0` is hardware-only and proposed/pending owner extension. It defines exactly one `HIL_RAW_TEST` lane and exactly the two existing `PROPOSED_ONLY` method IDs; storage power-loss remains outside.
- The existing evidence-capture profile remains four lanes with no HIL lane. The template has zero artifacts/results, all target/physical/session/tool/clock/custody fields null or pending, TestResult.rawArtifacts remains the sole result owner, and all effects are `NONE`.
 - Targeted result: validator `36/36` (`51f36cb346452b7db963324cc719b75d836f313ed3310d6e3c83215694d9b58b`); selftest baseline `36/36`, `41/43` rejected mutations and two benign cases accepted (`c1eed685c414a63cb1fe1c41eea0b139373cdbec59fed97f14988de21f30827f`). Software remains read-only with hardwareImpact=NONE and BOARD_TARGET=UNRESOLVED.
- Next exact manual action remains MB1 send/freeze (96), followed by benchmark 86, REF2 85, lab registration 77. No unblocked autonomous package is currently executable; EDA migration requires a controlled maintenance window and storage requires target evidence.
 - Integrated hardware reports at close: fixture validation 117/117 `eac8f8fd2faab8821113d60b2108b6a143f1036a5bdb144e2887a2f1e57bde01`, fixture selftest `9df0d71eb489deab08ff78753d4154f57299ceda0aeaed99f8360503aa2e201e`; method-gap validation 26/26 `1f323663bd81eec6d579a3c56fe27cf6652326ce2124c2203a6f729f6623fc8b`, selftest `b9d9f88cd61901006749b59b413fcd7609ac2d69f76d8d6b2640ac47b7e78a44`; contract validation 38/38 `b30f263ed46382c7307058c3a4d114c2321b4e95b5aedf8940b5bf6f5f53459`, selftest `2c3834a1d9d16406977ac66c141f36165b6246d283c2d40d7ac5c02826953252`.

- Final integrated report refresh: fixture validation 117/117 `eac8f8fd2faab8821113d60b2108b6a143f1036a5bdb144e2887a2f1e57bde01`; fixture selftest `9df0d71eb489deab08ff78753d4154f57299ceda0aeaed99f8360503aa2e201e`; method-gap validation 26/26 `1f323663bd81eec6d579a3c56fe27cf6652326ce2124c2203a6f729f6623fc8b`; method-gap selftest `b9d9f88cd61901006749b59b413fcd7609ac2d69f76d8d6b2640ac47b7e78a44`; contract validation 38/38 `b30f263ed46382c7307058c3a4d114c2321b4e95b5aedf8940b5bf6f5f53459`; contract selftest `2c3834a1d9d16406977ac66c141f36165b6246d283c2d40d7ac5c02826953252`.

## Maintenance-decoupling repair

- Removed root `package.json` from strict implementation identities. Package-owned schemas, template, README and two scripts remain byte/SHA locked.
- Added semantic npm wiring checks: exact validator/selftest commands and one ordered placement in `validate:hardware-rd` immediately after the fixture-method-contract pair.
- Targeted validator: 36/36; selftest baseline 36/36 with 41/43 rejected mutations and 2 benign cases (unrelated npm script addition and software route progression) accepted.
- Validation report SHA-256: `51f36cb346452b7db963324cc719b75d836f313ed3310d6e3c83215694d9b58b`; selftest report SHA-256: `c1eed685c414a63cb1fe1c41eea0b139373cdbec59fed97f14988de21f30827f`.
