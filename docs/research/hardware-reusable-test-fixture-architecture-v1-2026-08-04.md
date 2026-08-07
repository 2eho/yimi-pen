# HW-REUSABLE-TEST-FIXTURE-ARCHITECTURE-V1

> 日期：2026-08-04
>
> 结论：接受一个 target-neutral、版本化的 reusable fixture seam；不选择目标板、不继续芯片级 EDA，不把模板或 synthetic selftest 当作物理证据。

## 1. 决策摘要

现有工程已经有稳定的 `HardwareSystem` 拓扑、target-binding、lab 方法与仪器槽位、`TestResult v1`、ReleaseGate catalog 和 `HW-EVIDENCE-CAPTURE-ADAPTER-V1`。缺口不是再复制这些 owner，而是把它们接到一条可复用、低维护的硬件夹具接缝：

```text
stable fixture profile
  -> target adapter
  -> physical fixture instance / fixture-only selftest
  -> existing lab session / TestResult / raw evidence owners
```

本包使用四份 strict closed Draft 2020-12 schema、四份 deterministic template/profile JSON、一个 package README、一个 validator 和一个负向 selftest。所有效果为 `NONE`，`BOARD_TARGET=UNRESOLVED`。

## 2. 证据基础

本包只从仓库中的现有 owner 推导：

- `hardware/evt0/hardware-system-v1/topology.json` 是 12 blocks / 36 logical ports / 18 interfaces 的唯一稳定拓扑事实源；其 canonical topology identity 严格复用 `canonicalSha256(topologyHashInput(topology))`，其中 `topologyHashInput` 省略 `topologyId`。当前 canonical hash 为 `98a87a1de9ee8dfa52ec68ebd00afbbf23fa3c18e0c2a75e34ba09da4a9c4e5f`，raw file SHA-256 `96431fecb220882b16745082d803e9349675802d234eb5ddf75fa197dd5f63d5` 仅作独立 provenance；`target-binding.json.topologyRef.sha256` 使用 canonical hash。
- `hardware/evt0/hardware-system-v1/target-binding.json` 维持 `UNRESOLVED`，18/18 interface binding 为 `TARGET_EVIDENCE_PENDING`；精确目标五元组、目标电气和物理实施仍在证据门后。
- `hardware/evt0/lab-v1/method-catalog.json` 提供 9 个方法；`registration-capture-plan.json` 提供 6 个 instrument slot 和 7 类 asset；真实 registry 仍没有 physical record/qualified record。
- `hardware/evt0/test-result-v1/` 继续拥有点读/时延结果的 specimen、method、raw artifact、sample、queue 和 acceptance 语义；fixture package 只引用它的 schema/owner，不复制字段。
- `hardware/evt0/release-gates-v1/catalog.json` 继续拥有 34 个 gate 的 producer、artifact role 和 synthetic policy；fixture selftest 不能生成 physical receipt 或关闭 gate。
- `hardware/evt0/evidence-capture-v1/profile.json` 继续拥有原始外部字节复制、readback、hash、immutable index 和 rollback；fixture package 只保留最小 owner refs，不重新归档原始文件。

这些证据证明：方法、仪器、结果和原始字节 owner 已稳定存在，缺的是稳定夹具能力、目标适配器、物理实例和自检的独立身份/哈希接缝。

## 3. Capability mapping

固定的 8 个 capability ID 为：

1. `CAP-FIXTURE-EVIDENCE-ANCHOR`（cross-cutting）
2. `CAP-OPTICAL-PRESENTATION-DATUM`
3. `CAP-OID-EVENT-TIMING-OBSERVATION`
4. `CAP-POWER-SAFE-INJECTION`
5. `CAP-CONTENT-STORAGE-OFFLINE`
6. `CAP-USB-DATA-TRANSPORT`
7. `CAP-AUDIO-ACOUSTIC-OBSERVATION`
8. `CAP-CONTROL-STATUS-DIAGNOSTIC-HIL`

七个 operational family 精确分区 18 个稳定 interface：

| Family | Interface IDs | 现有覆盖状态 |
| --- | --- | --- |
| Optical/presentation | `IF-OID-OPTICAL`, `IF-HEAD-MECHANICAL` | `MECH-INTAKE-001`、`OID-OPTICS-INTAKE-001` |
| OID event/timing | `IF-OID-EVENT` | `PWR-BOARD-BOOT-001`、`OID-FUNCTION-001` |
| Power-safe injection | `IF-USB-POWER`, `IF-BATTERY-POWER`, `IF-BOARD-POWER`, `IF-AUDIO-POWER` | USB/power/board/battery methods |
| Content/storage/offline | `IF-STORAGE`, `IF-WIRELESS` | offline function partial |
| USB data transport | `IF-USB-DATA`, `IF-USB-MECHANICAL` | no dedicated method or instrument slot |
| Audio/acoustic | `IF-AUDIO-SIGNAL`, `IF-AUDIO-ACOUSTIC` | reference and target acoustic methods |
| Control/status/diagnostic/HIL | `IF-CONTROL`, `IF-STATUS`, `IF-DIAGNOSTIC`, `IF-BOARD-MECHANICAL`, `IF-USER-IO-MECHANICAL` | setup/boot/function partial |

The evidence anchor may cross-reference `IF-DIAGNOSTIC` as a cross-cutting identity envelope, but it is excluded from the operational partition. The validator checks unknown, duplicate and missing interface IDs.

## 4. Three-layer ownership

### 4.1 Stable fixture profile

The profile owns only target-neutral capability IDs, abstract instrument/asset references, status, owner references, coverage gaps and evidence policy. It does not own pins, rails, connector choice, pogo layout, mechanical dimensions, target board identity or physical qualification.

### 4.2 Target adapter

The adapter is the only future location for mapping a complete `BOARD_MPN / PCB_REV / HEAD_MPN / HEAD_REV / FW_VERSION` tuple to a fixture. The template is deliberately unresolved and references the exact profile, topology and target-binding identities. All concrete voltage/current/pin/connector/pogo/mechanical fields are null or empty pending fields. A future adapter still needs accepted same-revision intake, written supplier evidence and matching ReleaseGate receipts before it can carry target facts.

### 4.3 Physical instance and selftest

The instance will eventually bind a real fixture, adapter, lab registry and calibration/self-check artifacts. The shipped template claims none of those facts: no serial, local asset tag, calibration, qualification or physical readiness. The selftest is fixture-only and synthetic/pending. It can check identity, hash and boundary wiring but cannot promote a board, qualify the lab, close a ReleaseGate or convert synthetic evidence to physical evidence.

## 5. Explicit coverage gaps

The package exposes, rather than masks, three known gaps:

1. `IF-USB-DATA`: no dedicated method and no dedicated instrument slot; status `PENDING_METHOD_COVERAGE`.
2. Storage power-loss durability: `OID-FUNCTION-001` supplies only partial offline functional coverage; there is no dedicated durability method; status `PARTIAL_COVERAGE`.
3. Control/status: setup, boot and basic function are available, but no dedicated control/status method exists; status `PARTIAL_COVERAGE`.

Adding a method or instrument is a change to the existing `lab-v1` owner and must not be hidden inside this fixture package. Asset kinds are checked against the registration plan and instrument schema; method IDs, slot IDs and ReleaseGate IDs are all checked against their authoritative owners.

## 6. Reuse and maintenance economics

The high-value maintenance reduction is identity reuse, not premature hardware detail. A new target should require a new adapter and physical instance evidence while reusing one profile, the same lab methods, the same TestResult/raw-evidence owner routes and the same ReleaseGate catalog. Hash-bound references make a changed topology, owner catalog, schema or implementation fail at the seam instead of silently invalidating prior runs. The package therefore reduces repeated setup, path drift, and owner duplication without purchasing or designing an unproven fixture.

The same architecture also makes future cleanup cheaper: an added target-dependent fact is localized to adapter/instance evidence; a new test method is localized to the existing lab method owner; a new raw artifact remains under evidence-capture and its consumer owner. No general-purpose shared database or parallel lab contract is introduced.

## 7. Unresolved boundaries

- `BOARD_TARGET` and all 18 target bindings remain unresolved.
- Exact target board/head/firmware identity, electrical limits, event transport, storage medium, audio path, USB data mode, controls/status behavior and mechanical dimensions remain pending.
- No physical fixture, adapter, calibration standard, instrument registration or qualification record is created by this package.
- EDA readiness remains `SYSTEM_SKELETON_ONLY`; no symbol, pin, rail, connector, pogo or PCB layout work is implied.
- Synthetic JSON templates and selftest vectors are contract evidence only; they are not physical evidence and cannot close a physical gate.

## 8. Software read-only synchronization

The current software owner anchor was read without modification at
`docs/codex/tasks/system-product-rd/active-task.md` (SHA-256
`bcec3e3fd3b1cfa2c4c7f38608f3f6062b9b45712ea0b14dcc5d0a4095d14aeb`). The
current formal software report is
`build/companion-authoring-task-recovery-validation/report.json`, 22/22, SHA-256
`7c9535fc585c2593f0215c6ec37dfc54c706896361db4dc68e5393d2fbc76059`.
The explicit hardware-impact report remains
`build/companion-tts-source-adapter-validation/report.json`, SHA-256
`3421b0de9614162cb20c02d5320c162beaa84b7547f5ee62ff5ba6b83d0cdd5b` and is
the authority for `hardwareImpact=NONE`, `BOARD_TARGET=UNRESOLVED`,
`sessionCoreModified=false`, `familyWorkspaceModified=false`,
`productionProviderQualified=false` and `offlineReady=false`. The fixture
validator records both report identities and checks the current anchor by
stable boundary fields rather than a historical software task name. The
current software work does not add codec, storage, USB, OID-event,
control/status, power or mechanical requirements.

The fixture package itself also has no software write or software-owner-memory effect. Any later software impact must enter through a versioned interface, target adapter, TestResult or ReleaseGate change after new evidence; this package does not alter those owners.

## 9. Validation evidence

The acceptance path is:

```powershell
node --check scripts/validate-hardware-test-fixture.mjs
node --check scripts/test-hardware-test-fixture.mjs
npm run validate:hardware-test-fixture
npm run test:hardware-test-fixture
```

The validator compiles all four schemas, checks closed object nodes, exact capability/interface coverage, owner references, canonical topology identity, template pending boundaries, implementation bytes/SHA-256/revision, software read-only state and non-promoting effects. The negative selftest contains more than 20 mutation cases covering missing/extra/duplicate capability/interface, missing owner refs, concrete pre-target values, incomplete tuple, false target/physical/calibration/qualification claims, synthetic-as-physical evidence, promotion attempts, owner duplication/path/hash misuse, revision/hash drift and coverage-gap masking.

The completed targeted evidence is validator `117/117` and selftest baseline
`109/109` plus `40/40` rejected mutations. Current report SHA-256 values are
`54ef3fcd0f95d9a81bcb77684cd47851326507cd9c2fe35506aad8f1b52f459a` for
validation and `9df0d71eb489deab08ff78753d4154f57299ceda0aeaed99f8360503aa2e201e`
for selftest.

Reports are ignored build artifacts:

- `build/hardware-test-fixture-validation.json`
- `build/hardware-test-fixture-selftest.json`

## 10. Next decision

This autonomous package is accepted only as a reusable contract seam. The next hardware decision remains external and evidence-led: `HW-MB1-SEND-AND-FREEZE` (96), conditional benchmark buy/intake (86), REF2 seller request/capture (85), then lab physical registration (77). Chip-level EDA is not promoted by this package and remains behind the target evidence gate.
