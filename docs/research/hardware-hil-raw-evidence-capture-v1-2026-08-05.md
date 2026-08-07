# HW-HIL-RAW-EVIDENCE-CAPTURE-LANE-V1

## Decision

`HW-HIL-RAW-EVIDENCE-CAPTURE-LANE-V1` revision `1.0.0` is a proposed,
target-neutral owner extension. It closes the seam exposed by the accepted
USB/control-status fixture method contract, but it does not adopt a lane in
the current evidence-capture profile. The package status is
`PROPOSED_PENDING_OWNER_EXTENSION`; `BOARD_TARGET=UNRESOLVED`; every effect is
`NONE`.

Exactly one lane is defined: `HIL_RAW_TEST`. Exactly two method references are
allowed:

- `PROPOSED-USB-DATA-OBSERVATION-001` / `GAP-IF-USB-DATA-METHOD`;
- `PROPOSED-CONTROL-STATUS-HIL-001` / `GAP-CONTROL-STATUS-METHOD`.

Both remain `PROPOSED_ONLY` and `acceptedInMethodCatalog=false`. The storage
power-loss decision remains outside this package and
`KEEP_PENDING_MORE_PRIMARY_EVIDENCE`.

## Evidence inputs and ownership

The package reads, without rewriting, the revision-1.0.0 method-contract
manifest/run template, method-gap evidence manifest revision 1.1.0, accepted
fixture profile/adapter ownership, the four-lane evidence-capture profile, the
TestResult schema, target binding, ReleaseGate catalog and current software
boundary reports. The method-gap manifest remains the sole authority for the
nine official raw snapshots and the JEDEC HTTP-403 record; this package does
not duplicate raw source bytes or source hashes.

The ownership seam is deliberately narrow:

```text
proposed method contract
  -> HIL_RAW_TEST capture index (this package)
  -> existing TestResult.rawArtifacts reference owner
  -> existing lab/session, evidence and ReleaseGate owners
```

The new index owns routing, immutable relative paths, byte length, SHA-256,
media type/format, capture time/source, capture-tool identity/version/config
digest, session/run/TestResult references, clock/timebase/sample/channel
metadata where applicable, operator/custody/readback state and original versus
derived relationships. It does not own a target tuple, electrical or mechanical
facts, fixture serial/calibration/qualification, instrument allocation,
verdict, physical result or ReleaseGate receipt.

`TestResult.rawArtifacts` remains the result-to-artifact reference owner. The
fixture adapter remains the generic target/electrical/mechanical identity
owner. A future run remains the method-specific input owner. The current
evidence-capture profile still contains only `VENDOR_CONTACT`,
`BENCHMARK_SELLER`, `LAB_REGISTRY`, and `VENDOR_RESPONSE`; therefore the new
lane records `PENDING_OWNER_EXTENSION` with null adoption and capture-index
IDs rather than claiming readiness.

## Pending boundaries

The deterministic capture-index template contains zero artifacts and zero
results. All session, run, TestResult, fixture instance, target, software,
firmware, capture-tool, operator, custody, timestamp, clock, channel and
ReleaseGate values are null, empty or pending. A template or synthetic record
is never physical evidence. No method is inserted into the nine-method catalog,
no lab instrument slot is allocated, no board is resolved and no ReleaseGate
can be closed.

Actual future adoption still requires target/fixture/session evidence, an
owner-reviewed profile extension, a real run binding, original bytes with
readback and TestResult/ReleaseGate owner review. No part of that sequence is
performed here.

## Reuse and maintenance effect

The package removes a future duplicate-index design problem while reusing the
existing fixture method phases, TestResult raw-artifact field, evidence owner
policies and method-gap source IDs. A single strict artifact contract makes
USB and control/status captures comparable without introducing target values.
It also leaves the existing four-lane profile byte-stable, so adoption later
is an explicit owner decision rather than an accidental validator side effect.

## Software read-only synchronization

At package start and close, the software parent and desktop-authoring child
anchors were read only. The accepted desktop authoring report is 93/93. The
live semantic boundary remains `hardwareImpact=NONE`,
`BOARD_TARGET=UNRESOLVED`, `sessionCoreModified=false`,
`familyWorkspaceModified=false`, `productionProviderQualified=false`, and
`offlineReady=false`; no USB, storage, OID, codec, control/status, diagnostic,
power, acoustic or mechanical requirement entered the hardware line. The
validator intentionally checks these semantics, not a historical software task
name or hash.

## Verification evidence

The targeted validator recompiles both closed schemas, compares canonical JSON
text, proves exact lane/method/source/owner identities, verifies the four-lane
profile and TestResult owner, re-evaluates the current fixture and method-gap
semantic owners, checks the unresolved target and software boundary, and
recomputes all nine method-gap raw snapshot hashes. The negative selftest
mutates promotion, lane adoption, method/source/gap/output identity, target or
physical fields, owner paths, provenance, artifacts, result/verdict, software
boundary, raw-source identity, implementation identity and formatting. One
benign software route progression is labelled separately and remains accepted.

## Reranked next work

Using the fixed `30/20/20/10/10/10` model, the previous autonomous HIL lane
score was 82 (`24/19/14/9/8/8`), above EDA live migration 64 and storage
power-loss evidence 58. The package is now removed from pending. External
actions remain ahead and are not discounted because they require a person:

1. `HW-MB1-SEND-AND-FREEZE` — 96;
2. conditional `HW-BENCHMARK-BUY-AND-INTAKE` — 86;
3. `HW-REF2-SELLER-EVIDENCE-SEND-AND-CAPTURE` — 85;
4. `HW-LAB-INSTRUMENT-REGISTRATION` — 77.

The next autonomous choice is only reconsidered after these facts change. EDA
live migration remains maintenance-window gated, storage durability remains
target/storage/filesystem evidence gated, and chip-level EDA remains behind
the board/target evidence gate.

## Superseded pre-review ignored reports

- Initial pre-review validation (superseded): 34/34, `build/hardware-hil-raw-evidence-capture-validation.json`, SHA-256 `eb07a512ed95440f7f4e8d0b964876318645505a7ed2ac9683d79c3f370fa617`.
- Initial pre-review selftest (superseded): baseline 34/34, 36/37 mutations rejected and one benign progression accepted, `build/hardware-hil-raw-evidence-capture-selftest.json`, SHA-256 `88be299b729840ea9f501ffd7c5518f0ff44d138cdeb58269c4935e0bacac6ed`.

- Superseded pre-maintenance integrated reports (retained as historical provenance): fixture validation 117/117 `57de51b821e04e7c3314f16552cb688f98aac627a249ff2ddbb73b2730361ca8`, fixture selftest `9df0d71eb489deab08ff78753d4154f57299ceda0aeaed99f8360503aa2e201e`; method-gap validation 26/26 `3d7a1cc2723b71f94d085a2fc7d5a2b8f4ffe26f07d8fe263673a0fddca5131f`, selftest `b9d9f88cd61901006749b59b413fcd7609ac2d69f76d8d6b2640ac47b7e78a44`; contract validation 38/38 `88eb250186a2c35d75c5eeb5e0b37b282edd3e38259e8ab87725d3cd47c48ca0`, selftest `2c3834a1d9d16406977ac66c141f36165b6246d283c2d40d7ac5c02826953252`.

- Final integrated report refresh: fixture validation 117/117 `eac8f8fd2faab8821113d60b2108b6a143f1036a5bdb144e2887a2f1e57bde01`; fixture selftest `9df0d71eb489deab08ff78753d4154f57299ceda0aeaed99f8360503aa2e201e`; method-gap validation 26/26 `1f323663bd81eec6d579a3c56fe27cf6652326ce2124c2203a6f729f6623fc8b`; method-gap selftest `b9d9f88cd61901006749b59b413fcd7609ac2d69f76d8d6b2640ac47b7e78a44`; contract validation 38/38 `b30f263ed46382c7307058c3a4d114c2321b4e95b5aedf8940b5bf6f5f53459`; contract selftest `2c3834a1d9d16406977ac66c141f36165b6246d283c2d40d7ac5c02826953252`.

## Maintenance-decoupling repair

- Removed root `package.json` from strict implementation identities. Package-owned schemas, template, README and two scripts remain byte/SHA locked.
- Added semantic npm wiring checks: exact validator/selftest commands and one ordered placement in `validate:hardware-rd` immediately after the fixture-method-contract pair.
- Targeted validator: 36/36; selftest baseline 36/36 with 41/43 rejected mutations and 2 benign cases (unrelated npm script addition and software route progression) accepted.
- Validation report SHA-256: `51f36cb346452b7db963324cc719b75d836f313ed3310d6e3c83215694d9b58b`; selftest report SHA-256: `c1eed685c414a63cb1fe1c41eea0b139373cdbec59fed97f14988de21f30827f`.
