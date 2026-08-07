# HW-FIXTURE-METHOD-GAP-EVIDENCE-AUDIT-V1 (revision 1.1.0)

This package audits the three explicit method gaps exposed by the accepted
fixture profile. It is an evidence package, not a new lab method catalog and not
a physical qualification record.

## Boundary

- `hardware/evt0/lab-v1/method-catalog.json` is read-only in this phase.
- Proposed IDs use `PROPOSED_*` and remain `PROPOSED_ONLY`; none is accepted in
  the catalog or instrument registry.
- `BOARD_TARGET` remains `UNRESOLVED`.
- Storage technology, filesystem, USB class/mode/identity, control/status
  levels, debug route, pins, connectors, timing values, and physical thresholds
  remain `PENDING`.
- Effects are `NONE`: this package does not create physical evidence, qualify a
  fixture, close a ReleaseGate, promote a board, or alter software.

## Dependency semantics

The manifest keeps the first capture's dependency identities as
`AUDIT_SNAPSHOT_AT_CAPTURE` provenance. Those values are immutable audit facts;
they are not a requirement that a maintained fixture or software owner keep the
same bytes forever. Current fixture and owner health is evaluated through the
live fixture/owner semantic contracts (method catalog, registration plan,
topology, target binding, TestResult schema, ReleaseGate catalog,
evidence-capture profile, eight capabilities, 18 operational interfaces, the
three explicit gap records, and the unresolved target boundary).
Current software is checked through live boundary semantics only: the parent and
desktop owner anchors are read, the accepted formal report is retained as an
audit-time report rather than a newest-report requirement, and the explicit
hardware-impact report must still state `hardwareImpact=NONE`,
`BOARD_TARGET=UNRESOLVED`, `sessionCoreModified=false`,
`familyWorkspaceModified=false`, `productionProviderQualified=false`, and
`offlineReady=false`. Canonical artifacts therefore do not churn solely because
another line advances without hardware impact.

## Evidence records

`manifest.json` records exact URL, publisher, title, retrieval timestamp in
`Asia/Shanghai`, source version/date when stated, HTTP status, content type,
byte count, SHA-256, local raw path, license boundary, and claim boundary.
Captured public official snapshots are under `raw/`. The USB-IF page states a
limited/revocable internal-use license; the PDF is retained for local audit only
and is not redistributed by this package.

| Source | Gap | What it supports | What it does not support |
| --- | --- | --- | --- |
| USB-IF USB 2.0 compliance page/PDF | USB data | Revision-bound test assertions and raw transport/electrical evidence seam | USB class, VID/PID, endpoint, pin, connector, mode, or project threshold |
| USB-IF USB 2.0 landing page | USB data | Official revision anchor and update boundary | Target device identity or physical implementation |
| Micron SSD power-loss paper | Storage | Unexpected-power-loss, in-flight data, metadata, and recovery concepts | This target’s storage technology or pass criteria |
| KIOXIA NVMe data-loss brief | Storage | NVMe-specific mitigation concepts | An NVMe target assumption or generic storage contract |
| NVM Express specifications page | Storage | Conditional NVMe source-selection route | Storage technology selection |
| SD Association simplified specifications | Storage | Conditional SD-family source-selection route | SD target assumption or power-loss threshold |
| NI VeriStand HIL page | Control/status | Simulation integration, logging, automated validation, stimulus/fault-injection pattern | Target I/O, firmware behavior, debug route, or limits |
| OpenHTF project README | Control/status | Phases, measurements, attachments, plugs, DUT interaction, and trace records | Product qualification; README disclaims an official Google product |

The official JEDEC standards landing URL returned HTTP 403 during capture. No
JEDEC standard number, text, or threshold is inferred; the unavailable-source
record remains in `manifest.json`.

## Decisions

### IF-USB-DATA — `FREEZE_TARGET_NEUTRAL_SKELETON`

`PROPOSED-USB-DATA-OBSERVATION-001` is a target-neutral draft only. Its steps
bind a run, observe enumeration and representative transactions, repeat
disconnect/reconnect and interrupted-transfer behavior, and hash raw traces into
existing session/TestResult/evidence owners. The dedicated instrument slot is
still missing and remains an owner decision.

### IF-STORAGE power-loss — `KEEP_PENDING_MORE_PRIMARY_EVIDENCE`

`PROPOSED-STORAGE-POWER-LOSS-DURABILITY-001` remains a non-freezable draft. A
future method may create pre-interruption manifests, controlled interruption
traces, restart/recovery manifests, and byte/metadata comparisons, but the
storage technology, filesystem, commit model, recovery semantics, interruption
phases, cycle count, allowed loss, and pass threshold are not established.

### IF-CONTROL / IF-STATUS HIL — `FREEZE_TARGET_NEUTRAL_SKELETON`

`PROPOSED-CONTROL-STATUS-HIL-001` may freeze the logical contract: bind build
and fixture identity, declare logical stimuli and observation predicates, record
stimulus/observation ordering and diagnostic artifacts, then attach raw traces
to existing owners. Physical I/O, debug transport, firmware state codes,
timing/debounce, fault model, and thresholds remain pending.

## Later method-contract recommendation

The later owner package should be scored independently after external target
evidence arrives. Current audit scores are: USB data **74/100**, control/status
HIL **72/100**, and storage power-loss **58/100**. A later package may accept the
two frozen skeletons first, while storage waits for a proven storage/filesystem
identity and a public or supplier primary durability contract. No score closes a
ReleaseGate.

## Validation

```powershell
node --check scripts/validate-hardware-method-gap-evidence.mjs
node --check scripts/test-hardware-method-gap-evidence.mjs
npm run validate:hardware-method-gap-evidence
npm run test:hardware-method-gap-evidence
```

The validator recompiles the closed schema, verifies official host/publisher
allowlists, re-hashes every raw snapshot and the complete nine-file raw
directory, checks the three gap mappings and proposed-only state, verifies
stable lab/topology/TestResult/ReleaseGate/evidence owners, evaluates the live
fixture semantics, rechecks `BOARD_TARGET=UNRESOLVED`, and reads current
software state without writing it. The negative selftest rejects raw/source
drift, audit-snapshot provenance tampering, unofficial domains, missing
retrieval data, frozen target parameters, accepted-method claims, physical
qualification claims, software-boundary promotion, and implementation drift.

The accepted targeted result is `26/26`; the negative selftest baseline is
`26/26` with `30/31` mutations rejected. One accepted selftest case deliberately
changes current dependency identity metadata while preserving semantics, proving
that live owner drift is not rejected solely by an audit-time hash; semantic
drift remains rejected. The reports are ignored build outputs and never
represent physical evidence.
