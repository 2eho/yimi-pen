# HW-FIXTURE-METHOD-CONTRACT-USB-CONTROL-HIL-V1 (2026-08-05)

## Decision boundary

This package freezes reusable target-neutral contracts for the two gaps that
the preceding primary-source audit classified as `FREEZE_TARGET_NEUTRAL_SKELETON`:

- `PROPOSED-USB-DATA-OBSERVATION-001` for `GAP-IF-USB-DATA-METHOD`;
- `PROPOSED-CONTROL-STATUS-HIL-001` for `GAP-CONTROL-STATUS-METHOD`, with
  `IF-DIAGNOSTIC` as supporting context.

Both remain `PROPOSED_ONLY` and `acceptedInMethodCatalog=false`. The storage
power-loss proposal is deliberately not included; it remains
`KEEP_PENDING_MORE_PRIMARY_EVIDENCE`. `BOARD_TARGET=UNRESOLVED`, all effects
are `NONE`, and no physical evidence, qualification or ReleaseGate receipt is
created.

## Evidence and source routing

The package points to `hardware/evt0/method-gap-evidence-v1/manifest.json`
revision `1.1.0` and routes claims by source ID only. It does not copy or
re-hash the nine raw source files. USB contract claims remain bounded by the
three captured USB-IF source IDs; HIL process/trace claims remain bounded by
the NI VeriStand and OpenHTF source IDs. The earlier USB, storage and HIL
claim boundaries remain authoritative, including the inaccessible JEDEC 403
record and the storage decision.

## Contract layers and reuse economics

The package has four deterministic layers:

1. `manifest.json` is the stable target-neutral contract layer. It defines
   logical roles, four ordered phases, raw artifact kinds, owner projections and
   failure/no-promotion semantics.
2. `adapter.template.json` is a method-scoped seam. It contains only the
   `METHOD_ADAPTER` fields for each proposed method; every value is `null`,
   every state is `PENDING_EVIDENCE`, and every evidence-ref slot is empty.
   USB keeps transport mappings here; control/status keeps channel, timing,
   stimulus/trace-clock and flash/log route mappings here. The accepted
   fixture adapter remains the sole owner of the board/head/firmware tuple,
   physical `PIN_MAPPING`/`CONNECTOR`, generic electrical/mechanical, serial,
   calibration, qualification and readiness facts. Run-owned scenario,
   payload, fixture, firmware-lane, fault, measurement, result and evidence
   fields are absent here.
3. `run.template.json` binds the contract package/revision, explicitly
   references the existing fixture adapter by path/id/revision, and records
   the authoritative TestResult raw-artifact owner. Method-scoped pending
   input slots store USB `CABLE_OR_FIXTURE_ID`/`PAYLOAD_SET` and HIL
   `FAULT_MODEL`/`EXPECTED_SEQUENCE`/`MEASUREMENT_SET`/
   `ACCEPTANCE_PREDICATES`. `FIXTURE_INSTANCE` resolves to
   `fixtureInstance.id`; session, result, raw-evidence and ReleaseGate fields
   resolve to their owner paths. Real IDs remain absent.
4. Existing fixture, lab session, TestResult, raw evidence/evidence-capture and
   ReleaseGate owners remain the only owners of later physical facts.

This keeps a future target change inside one method adapter and one run
binding. USB transport-tool changes affect the USB method-adapter branch;
firmware/control changes affect the HIL branch; storage remains outside this
package. No stable catalog, instrument registry, target binding, BOM, EDA,
firmware or software file is duplicated or edited.

## Contract mapping

| Contract | Ordered phases | Raw artifact kinds | Pending examples |
|---|---|---|---|
| USB observation | bind profile/adapter/instance; enumerate and run accepted logical transactions; disconnect/reconnect/interruption; hash and project owner refs | `enumeration_trace`, `transfer_trace`, `disconnect_reconnect_trace`, `raw_capture_manifest`, `session_binding_ref` | role, revision, mode, class, VID/PID, endpoints, transfer types, payload, framing, connector, pins, timing |
| Control/status HIL | bind firmware/channel/diagnostic context; declare logical stimulus/observation; execute and trace HIL; attach owner refs | `stimulus_trace`, `observation_trace`, `diagnostic_log`, `measurement_manifest`, `attachment_manifest` | firmware version, channels, debug route, levels, timing/debounce, state codes, fault model, flash/log route, predicates |

The phase text and raw-output intent are copied as contract structure from the
evidence audit, not as physical evidence. Future USB scenarios reference an
accepted DeviceLink/software transaction scenario by a later run-binding field.
Future control/status runs may name a firmware artifact role and either a
C-reference or Rust-product implementation lane only after evidence exists;
the current template asserts neither.

## Field ownership and capture-lane gap

Each method has an exact `fieldOwnership` map. Phase fields resolve once to
`METHOD_ADAPTER`, `RUN_BINDING`, `EXISTING_FIXTURE_ADAPTER`, or
`OWNER_REFERENCE`; the validator proves phase union, ownership union, adapter
fields, run-input slots and owner paths are equal without duplication or
orphan fields. `PIN_MAPPING` is independently scoped per method but resolves
only through the accepted fixture adapter's `targetDependent.pinMappings`.
The other fixture-owned paths are `targetDependent.connectorMappings` and
`targetIdentity.fullFiveTuple.FW_VERSION`.

The existing evidence-capture profile exposes only
`VENDOR_CONTACT`, `BENCHMARK_SELLER`, `LAB_REGISTRY`, and `VENDOR_RESPONSE`.
It has no HIL/raw-test lane. The run and owner projection therefore retain
`captureRouteState=PENDING_OWNER_EXTENSION`, `laneId=null`, and
`captureIndexId=null`; `TestResult.rawArtifacts` remains the current result
owner. A future capture-lane extension is a separate owner decision.

## Ownership and effects

The method catalog remains the accepted-method authority. The proposed IDs are
not present in it, no instrument slot or asset kind is allocated, and the
owner projection contains only minimal reference-field names. `TestResult`,
evidence-capture and ReleaseGate remain external owners. Missing target
evidence yields `PENDING_EVIDENCE`/`NOT_SET`, never a pass/fail verdict,
qualification, physical readiness or target promotion.

## Software read-only delta

At package start and close, the software parent and desktop child were read
without modification. The desktop adapter is complete; the parent next route
is `SW-FAMILY-WORKSPACE-LIFECYCLE-01`. Current software semantics remain
`hardwareImpact=NONE`, `BOARD_TARGET=UNRESOLVED`, `sessionCoreModified=false`,
`familyWorkspaceModified=false`, `productionProviderQualified=false`, and
`offlineReady=false`. No USB, storage, OID, codec, control/status, diagnostic
or device-install constant was added. Validator validity uses these live
boundary facts, not task names or evolving hashes. The accepted desktop report
is `build/companion-desktop-authoring-task-validation/report.json` (currently
93/93, SHA-256
`bc28adad4b4a27ade9ef573fc1a27abf8ddc8422a4d4e30e0e5a846bd92b9b24`); the
older recovery report is retained only as separate audit-time history.
The current parent/child anchor hashes are
`0efb93463bc6b2a405acaa8d9e50d8742f35d2a6ff426e9cd721e2e4b8bbb6a2` and
`3d88156f5c97c100132c0d487dc7948ec613aa56e39b7698afcef0405814edd7`; the
explicit hardware-impact report SHA-256 is
`f3f9dad07c7c710fd6bd03553c03e062ac4ad135522839b2bf510d52819708f0`.

## Validation evidence

The package validator compiles the three closed schemas and compares every
package JSON file with canonical pretty-printed JSON plus a newline. It checks
deterministic manifest/template identity, exact two-contract and
phase/interface/source coverage, field-ownership closure, method-adapter
scoping, method-scoped pending run-input storage, direct/owner/fixture path
resolution, proposed-only state, owner paths, the absent HIL capture lane, null
run bindings, current method-gap and fixture semantic validators, accepted
desktop-report/live software boundaries, implementation identities and
all-NONE effects. The negative selftest covers fixture/run duplication,
ownership gaps, false HIL readiness, formatting, promotion, target
values/thresholds, phase/order/interface/gap/source/output/owner drift,
populated/missing/extra/duplicate run-input slots, physical PIN_MAPPING and
HIL-route leaks, owner-reference/fixture-path misrouting, verdict/ReleaseGate
claims, software impact, storage inclusion, implementation drift, live semantic
drift and a benign software task/hash progression case.

Current reports (ignored build outputs):

- Contract validator: `38/38`, SHA-256
  `c87519784da436460aae3d163b919faa33cddc150a2cc1b264b585c43b51b491`.
- Contract selftest: baseline `38/38`, `42/43` mutations rejected (one benign
  software task/hash progression accepted), SHA-256
  `2c3834a1d9d16406977ac66c141f36165b6246d283c2d40d7ac5c02826953252`.
- Fixture validator/selftest: `117/117`, `40/40` rejected; validation SHA-256
  `768ee8389849db8e79f6d4620639891e75d6edf8ace12a20e95d809ccb7d35e5` and
  `9df0d71eb489deab08ff78753d4154f57299ceda0aeaed99f8360503aa2e201e`.
- Method-gap validator/selftest: `26/26`, `30/31` rejected; validation
  SHA-256 `0580ac3b7d9071ffe39cac4eeb2a62d914eb6cf5e1cff88c5e8d7cf673485df6`
  and selftest SHA-256
  `b9d9f88cd61901006749b59b413fcd7609ac2d69f76d8d6b2640ac47b7e78a44`.
- Existing fixture and method-gap suites remain required gates and are not
  rewritten by this package.

## Reranked next actions (30/20/20/10/10/10)

External actions remain ahead: MB1 send/freeze **96**, conditional benchmark
buy/intake **86**, REF2 seller capture **85**, and lab physical registration
**77**. After those facts, the next autonomous choice is selected from
evidence rather than forced EDA: retain controlled EDA migration at **64**,
storage power-loss evidence at **58**, and custom PCB at **29** until target
identity and primary physical evidence exist. This package is removed from the
pending queue after acceptance.

## Final verification refresh

The latest integrated run refreshed ignored reports without changing any
canonical contract or stable owner. Fixture validation/selftest remain
`117/117` and `40/40`; method-gap validation/selftest remain `26/26` and
`30/31`; contract validation/selftest remain `38/38` and `42/43` (one benign
software task/hash progression accepted). Current report SHA-256 values are:

| Report | SHA-256 |
|---|---|
| `build/hardware-test-fixture-validation.json` | `d9633130235f735ae61a5087184c6337a4414f65431801a33fefa9a9056e05c4` |
| `build/hardware-test-fixture-selftest.json` | `9df0d71eb489deab08ff78753d4154f57299ceda0aeaed99f8360503aa2e201e` |
| `build/hardware-method-gap-evidence-validation.json` | `bd7664f45025362c88f8846ad1de338058cdd51440983dabd76004ecb98254d7` |
| `build/hardware-method-gap-evidence-selftest.json` | `b9d9f88cd61901006749b59b413fcd7609ac2d69f76d8d6b2640ac47b7e78a44` |
| `build/hardware-fixture-method-contract-validation.json` | `ced7167a1a915f75a5b46baaf47856cacef7547e826bc9be7e9c7cf6deae5c7e` |
| `build/hardware-fixture-method-contract-selftest.json` | `2c3834a1d9d16406977ac66c141f36165b6246d283c2d40d7ac5c02826953252` |

The current accepted desktop report is read-only `93/93`, SHA-256
`bc28adad4b4a27ade9ef573fc1a27abf8ddc8422a4d4e30e0e5a846bd92b9b24`; its
`hardwareImpact=NONE` and `boardTarget=UNRESOLVED`. Current parent/child anchor
hashes are `0efb93463bc6b2a405acaa8d9e50d8742f35d2a6ff426e9cd721e2e4b8bbb6a2`
and `3d88156f5c97c100132c0d487dc7948ec613aa56e39b7698afcef0405814edd7`;
the explicit impact report SHA-256 is
`f3f9dad07c7c710fd6bd03553c03e062ac4ad135522839b2bf510d52819708f0`, with
all required boundaries still false/NONE/unresolved. No software
`validate:full` run is claimed.
