# Hardware fixture method-gap evidence audit (2026-08-04)

## Scope and decision boundary

This audit is the evidence package for three explicit gaps in the accepted
`hardware/evt0/test-fixture-v1/` architecture:

1. `IF-USB-DATA` dedicated method and instrument coverage;
2. `IF-STORAGE` power-loss durability;
3. `IF-CONTROL` / `IF-STATUS` stimulus and observation HIL coverage.

The audit reads the stable topology, target binding, nine-method lab catalog,
six instrument slots/seven asset kinds, TestResult, ReleaseGate and evidence
capture owners. It does not edit any of those owners, the accepted fixture
package, firmware, software source, or software-owner memory. Proposed method
IDs remain `PROPOSED_ONLY`. The audit package itself has `effects=NONE` and does
not create physical evidence or close a ReleaseGate.

`BOARD_TARGET` remains `UNRESOLVED`. The canonical topology identity is
`canonicalSha256(topologyHashInput(topology))`, with `topologyId` omitted from
the hash input:

- canonical identity SHA-256:
  `98a87a1de9ee8dfa52ec68ebd00afbbf23fa3c18e0c2a75e34ba09da4a9c4e5f`;
- raw topology file SHA-256:
  `96431fecb220882b16745082d803e9349675802d234eb5ddf75fa197dd5f63d5`;
- stable topology interfaces: 18/18;
- target-binding interfaces: 18/18 `TARGET_EVIDENCE_PENDING`.

## Source capture policy

Only public primary/official pages, specifications, vendor technical material,
or the primary project source were captured. Every captured record below is
also present in `hardware/evt0/method-gap-evidence-v1/manifest.json` and is
rechecked against the local raw file by the validator. `retrievedAt` uses
Asia/Shanghai (`+08:00`). The USB PDF is retained as an internal snapshot only
because the USB-IF page states a limited/revocable internal or personal-use
license boundary; it is not redistributed by this repository. OpenHTF is a
primary project README, but its own README says it is not an official Google
product, so it is process-pattern evidence rather than a Google product claim.

## Evidence register

| Source | Publisher and title | Exact URL | Retrieved (`+08:00`) | Version/date | HTTP / content type / bytes | SHA-256 | Local raw path |
|---|---|---|---|---|---|---|---|
| `SRC-METHOD-GAP-USB-COMPLIANCE-PAGE` | USB-IF — USB 2.0 Electrical Compliance Test Specification | `https://www.usb.org/document-library/usb-20-electrical-compliance-test-specification` | `2026-08-04T17:25:59.872+08:00` | Version 1.08; page date 2026-04-21 | 200 / `text/html; charset=UTF-8` / 41422 | `5adb045d7a628acad82e22681ba2689464df6b6276a7115e65502b920f7f252c` | `hardware/evt0/method-gap-evidence-v1/raw/usb-if-usb20-electrical-compliance-landing.html` |
| `SRC-METHOD-GAP-USB-COMPLIANCE-PDF` | USB-IF — USB 2.0 Electrical Compliance Specification | `https://www.usb.org/sites/default/files/USB2%20Electrical%20Compliance%20Specification%20v1.08.pdf` | `2026-08-04T17:26:02.133+08:00` | Version 1.08; page date 2026-04-21 | 200 / `application/pdf` / 836863 | `04c8f4bd54fd8669b538cf648d9b41eb3417771ac0544877272bc207ce543508` | `hardware/evt0/method-gap-evidence-v1/raw/usb-if-usb20-electrical-compliance.pdf` |
| `SRC-METHOD-GAP-USB-BASE-PAGE` | USB-IF — USB 2.0 Specification landing page | `https://www.usb.org/document-library/usb-20-specification` | `2026-08-04T17:26:02.392+08:00` | Page date 2025-06-03; original release 2000-04-27 | 200 / `text/html; charset=UTF-8` / 44664 | `6124bdcafece22b95679065937a70c415486793827a8291367f10488156338ea` | `hardware/evt0/method-gap-evidence-v1/raw/usb-if-usb20-specification-landing.html` |
| `SRC-METHOD-GAP-STORAGE-MICRON-PLP` | Micron Technology — How Micron SSDs Handle Unexpected Power Loss | `https://www.micron.com/content/dam/micron/global/public/products/white-paper/ssd-power-loss-protection-white-paper-lo.pdf` | `2026-08-04T17:26:05.564+08:00` | Not stated on captured page | 200 / `application/pdf` / 379488 | `dcc0f5234e738505f53919d92d70fb621eab5ba21b1e2c9671e5f4686577926b` | `hardware/evt0/method-gap-evidence-v1/raw/micron-ssd-power-loss-protection.pdf` |
| `SRC-METHOD-GAP-STORAGE-KIOXIA-DATA-LOSS` | KIOXIA — Data Loss Mitigation with KIOXIA Enterprise and Data Center NVMe SSD | `https://americas.kioxia.com/content/dam/kioxia/en-us/business/ssd/asset/KIOXIA_NVMe_SSDs_Data_Loss_Mitigation_Tech_Brief.pdf` | `2026-08-04T17:26:05.977+08:00` | Not stated on captured page | 200 / `application/pdf` / 712488 | `999908bb12ab65385fa47c2f39b6a4c026e4d54b2b637df894d4225dc3c39e33` | `hardware/evt0/method-gap-evidence-v1/raw/kioxia-nvme-data-loss-mitigation.pdf` |
| `SRC-METHOD-GAP-STORAGE-NVME-SPECIFICATIONS` | NVM Express — Specifications | `https://www.nvmexpress.org/specifications/` | `2026-08-04T17:26:07.444+08:00` | Latest set release stated as 2025-08-05 | 200 / `text/html; charset=UTF-8` / 88200 | `f7af2d174ef871b0659a113b4d4c60575cb63f42c084b6001f9f78262e5eda3a` | `hardware/evt0/method-gap-evidence-v1/raw/nvme-specifications-landing.html` |
| `SRC-METHOD-GAP-STORAGE-SD-SPECS` | SD Association — Simplified Specifications | `https://www.sdcard.org/downloads/pls/` | `2026-08-04T17:39:34.071+08:00` | Not stated on captured page | 200 / `text/html; charset=UTF-8` / 77520 | `4f0a206b5530d1ae011f36a159f920a07cac0ddf59bfe5213cb500a46ef636ec` | `hardware/evt0/method-gap-evidence-v1/raw/sd-association-simplified-specifications.html` |
| `SRC-METHOD-GAP-HIL-NI-VERISTAND` | NI — What is VeriStand? | `https://www.ni.com/en/shop/data-acquisition-and-control/application-software-for-data-acquisition-and-control-category/what-is-veristand.html` | `2026-08-04T17:26:09.449+08:00` | Not stated on captured page | 200 / `text/html; charset=utf-8` / 562394 | `5f8dc71c582b08f3a519dd11424def92e26823ee261618a614a791327f7c1354` | `hardware/evt0/method-gap-evidence-v1/raw/ni-veristand-hil.html` |
| `SRC-METHOD-GAP-HIL-OPENHTF` | OpenHTF project — README | `https://raw.githubusercontent.com/google/openhtf/master/README.md` | `2026-08-04T17:27:37.134+08:00` | Not stated on captured page | 200 / `text/plain; charset=utf-8` / 6330 | `323d8743680b870e568abc60009a28c0bf899179f0dbe93fecb5cc9344c23c82` | `hardware/evt0/method-gap-evidence-v1/raw/openhtf-readme.md` |

### Inaccessible official source

`SRC-METHOD-GAP-UNAVAILABLE-JEDEC-POWER-LOSS` records the official JEDEC
landing URL `https://www.jedec.org/standards-documents`, publisher `JEDEC`,
title `Standards Documents`, retrieval `2026-08-04T17:39:00.000+08:00`
(`Asia/Shanghai`), HTTP 403, no content type, no local raw file, and
`accessState=INACCESSIBLE`. No JEDEC standard number, text, or threshold is
claimed from this response.

## Claim/evidence mapping and decisions

| Gap | Evidence-supported claim boundary | Target-neutral skeleton justified | Target/physical fields that stay pending | Decision |
|---|---|---|---|---|
| `IF-USB-DATA` (`PROPOSED-USB-DATA-OBSERVATION-001`) | USB-IF provides a revision and compliance-test anchor. It supports a logical transport observation contract, not the target class, identity, mode, endpoints, pins, connector or project limit. | Bind profile/adapter/session; observe enumeration; run accepted logical read/write cases; observe disconnect/reconnect/interrupted transfer; preserve ordered timestamps, raw traces and owner references. Raw outputs: enumeration trace, transfer trace, disconnect/reconnect trace, raw capture manifest, session binding reference. | `USB_ROLE`, `USB_REVISION`, `USB_MODE`, `CLASS`, `VID_PID`, `ENDPOINTS`, `TRANSFER_TYPES`, `PAYLOAD_SET`, `FRAMING`, `CONNECTOR`, `PIN_MAPPING`, `TIMING_THRESHOLDS`; all acceptance thresholds. | **`FREEZE_TARGET_NEUTRAL_SKELETON`**, score 74 for a later method-contract package. |
| `IF-STORAGE` (`PROPOSED-STORAGE-POWER-LOSS-DURABILITY-001`) | Micron/KIOXIA describe unexpected-power-loss behavior for named SSD technologies; NVM Express and SD Association publish conditional family specification paths. None proves this target’s storage technology, filesystem, commit semantics or recovery contract. JEDEC landing access was 403. | Only a pending draft: capture pre-interruption bytes/metadata manifest; define a target-selected checkpoint; interrupt at target-defined write/idle phases; restart through the target recovery path; compare bytes, metadata, generation and error/status artifacts. Raw outputs: pre-interrupt manifest, power-interrupt trace, post-recovery manifest, recovery/corruption log, hash comparison. | `STORAGE_TECHNOLOGY`, `FILESYSTEM`, `CAPACITY`, `COMMIT_MODEL`, `CONTENT_SET`, `CHECKPOINT_RULE`, `POWER_PATH`, `INTERRUPTION_PHASES`, `RESTART_SEQUENCE`, `RECOVERY_WINDOW`, `INTEGRITY_RULE`, `ALLOWED_LOSS_RULE`, `DURABILITY_CYCLES`, `PASS_THRESHOLD`; all physical thresholds. | **`KEEP_PENDING_MORE_PRIMARY_EVIDENCE`**, score 58 for a later method-contract package. |
| `IF-CONTROL` / `IF-STATUS` (supporting `IF-DIAGNOSTIC`, `PROPOSED-CONTROL-STATUS-HIL-001`) | NI documents HIL integration, logging, automated embedded validation and real-time stimulus/fault injection. OpenHTF documents phases, measurements, attachments, plugs and DUT interaction, with its non-Google-product caveat. These support process/trace structure, not target I/O levels or firmware semantics. | Bind firmware/build identity, logical channel names, diagnostic route, fixture and session; declare logical stimulus/observation predicates; execute sequence; capture order, diagnostic logs, measurements, build/flash witness and fault outcome; attach raw traces to existing owners. Raw outputs: stimulus trace, observation trace, diagnostic log, measurement manifest, attachment manifest. | `FIRMWARE_VERSION`, `CONTROL_CHANNELS`, `STATUS_CHANNELS`, `DEBUG_TRANSPORT`, `STIMULUS_LEVELS`, `TIMING`, `DEBOUNCE`, `STATE_CODES`, `PIN_MAPPING`, `TRACE_CLOCK`, `FAULT_MODEL`, `FLASH_ROUTE`, `LOG_ROUTE`, `EXPECTED_SEQUENCE`, `ACCEPTANCE_PREDICATES`; all physical thresholds. | **`FREEZE_TARGET_NEUTRAL_SKELETON`**, score 72 for a later method-contract package. |

The classification “freeze” applies only to a target-neutral skeleton in this
audit package. It does not insert a method into the stable nine-method catalog,
add an instrument slot or asset kind, create a physical fixture, qualify a
fixture, or change a ReleaseGate. Storage remains a deliberately non-freezable
draft until primary target evidence identifies the storage and recovery model.

## Ownership and reuse/maintenance effect

The later contract should preserve three layers:

1. **Stable method owner:** the existing lab method catalog, instrument-slot
   registration and asset-kind owner remain the only accepted method/asset
   authorities. This audit references them and exposes missing coverage; it
   does not duplicate or edit them.
2. **Target-neutral contract layer:** proposed IDs, logical steps, raw-output
   names, claim boundaries and pending parameter slots can be reviewed once
   the missing evidence arrives. The contract should bind profile/adapter,
   session, TestResult and raw evidence by minimal refs/hashes rather than
   copying those owners.
3. **Physical target layer:** target adapter, fixture instance, calibrated
   instruments, firmware behavior and physical thresholds are populated only
   from target evidence and actual owner records. A skeleton cannot stand in
   for a measurement or qualification.

This separation makes reuse cheap: a new target should normally supply an
adapter and target parameter bundle while reusing the logical trace schema,
raw-output manifest and owner routing. It also keeps maintenance bounded: a
USB or HIL tool change is isolated to the later method/adapter package, while a
storage technology change reopens only the storage branch. The current package
does not claim that a new target can be tested without resolving those fields.

## Software read-only delta

The latest software owner state was read without modification:

- software anchor:
  `docs/codex/tasks/system-product-rd/active-task.md`, current SHA-256
  `3161603ce8d7e59134b6b0ec7b7339a7e2d27573aa1c94508ada29d2fcc1198a`;
- desktop software child anchor:
  `docs/codex/tasks/desktop-authoring-ui-adapter/active-task.md`, current
  SHA-256 `2264078407a2afefe78b09ab4fadd04ac14f676383b5d39fd2990946d4a5e006`;
- newest formal software report:
  `build/companion-authoring-task-recovery-validation/report.json`, 22/22,
  SHA-256 `7c9535fc585c2593f0215c6ec37dfc54c706896361db4dc68e5393d2fbc76059`;
- explicit hardware-impact report:
  `build/companion-tts-source-adapter-validation/report.json`, SHA-256
  `7d6cb6dd3b4163920af212d7a88e1f8c8cda6e9aeb3e428f499c7e755e1b7202`;
- `hardwareImpact=NONE`, `boardTarget=UNRESOLVED`,
  `sessionCoreModified=false`, `familyWorkspaceModified=false`,
  `productionProviderQualified=false`, `offlineReady=false`;
- no new codec, storage, USB, OID-event, control/status, power, acoustic or
  mechanical hardware requirement was found.

Therefore this evidence audit has no software impact and did not modify the
software source or software-owner memory.

## Validation evidence

The package is revision `1.1.0`. The validator recompiles the strict schema,
checks official-domain and source metadata rules, recomputes all nine raw
snapshot bytes/SHA-256 values, checks the canonical topology identity, resolves
owner references, confirms the stable lab/topology/TestResult/ReleaseGate/
evidence owners, and evaluates the current fixture through its live validator
and semantic invariants. The first fixture/software dependency identities are
retained as `AUDIT_SNAPSHOT_AT_CAPTURE` provenance rather than live byte-equality
requirements. Current software is checked by task-name-independent boundary
semantics; the accepted formal report remains an audit-time report, while the
explicit hardware-impact report is authoritative for the live `NONE` boundaries.
The negative selftest mutates raw/source hashes and metadata, audit snapshots,
domain, retrieval data, gap coverage, target parameters, accepted-method and
physical claims, promotion/effect fields, software boundaries, decisions and
implementation identities.

Current targeted reports are:

- `build/hardware-method-gap-evidence-validation.json`: `26/26` passed,
  SHA-256 `f2c21264bdc08233b1e7ff0da939543090b8caea01876b99a0ae75ea78cc32d8`;
- `build/hardware-method-gap-evidence-selftest.json`: baseline `26/26`,
  `30/31` mutations rejected (one benign current-identity drift accepted),
  SHA-256 `b9d9f88cd61901006749b59b413fcd7609ac2d69f76d8d6b2640ac47b7e78a44`.

The accepted fixture dependency remains `117/117`; its selftest remains
`109/109` baseline with `40/40` rejected mutations. The method-gap package
does not require the fixture's historical hashes to remain current, but does
require these live semantic facts: exactly eight capabilities, 18 operational
interfaces, the three explicit fixture gaps, and `BOARD_TARGET=UNRESOLVED`.

## Next decision and reranked actions

This package is removed from the pending queue. The next method-contract
decision is to ask the lab method owner whether the USB and control/status
target-neutral skeletons should become accepted method contracts after review;
the storage branch remains pending target storage identity and primary recovery
evidence. Suggested later-package scores are USB 74, control/status 72, and
storage 58. No chip-level EDA work is promoted by this audit.

The current hardware ranking keeps the external actions ahead:

| Rank | Work package | Score | Gate/action |
|---:|---|---:|---|
| 1 | `HW-MB1-SEND-AND-FREEZE` | **96** | Human sends the prepared supplier evidence request and preserves the receipt. |
| 2 | conditional `HW-BENCHMARK-BUY-AND-INTAKE` | **86** | Only after the REF2 same-item seller evidence gate passes. |
| 3 | `HW-REF2-SELLER-EVIDENCE-SEND-AND-CAPTURE` | **85** | Send and capture the eleven same-item seller originals. |
| 4 | `HW-LAB-INSTRUMENT-REGISTRATION` | **77** | Capture the six slot/seven asset identity and calibration/reference originals. |
| 5 | `HW-FIXTURE-METHOD-CONTRACT-USB-CONTROL-HIL-V1` | **73** | Later owner-review package; proposed IDs remain unaccepted until the catalog owner decides. |
| 6 | `HW-EDA-SHARED-HTTP-LIVE-MIGRATION` | **64** | Only in a controlled maintenance window when live EDA is a real prerequisite. |
| 7 | `HW-FIXTURE-STORAGE-POWER-LOSS-EVIDENCE-V2` | **58** | Reopen after target storage technology, filesystem and recovery evidence exist. |
| 8 | chip-level custom PCB | **29** | Remains locked behind board/target evidence; do not use EDA to replace it. |

Required physical/external actions remain real supplier contact, benchmark
seller evidence, benchmark purchase/intake after its gate, lab asset capture,
and later target-board/OID/storage/power/acoustic/structure/HIL evidence. None
was executed or represented as synthetic physical evidence in this package.
