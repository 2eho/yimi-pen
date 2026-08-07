# HW-HIL-RAW-EVIDENCE-CAPTURE-LANE-V1

This is a hardware-owned, target-neutral owner extension for the HIL/raw-test
artifacts exposed by the USB-data and control/status method contracts. It is
revision `1.0.0`, `PROPOSED_PENDING_OWNER_EXTENSION`, and is not an adopted
lane of `hardware/evt0/evidence-capture-v1`.

## Seam and ownership

The intended future seam is:

```text
proposed method contract
  -> HIL_RAW_TEST lane/index (this package)
  -> existing TestResult.rawArtifacts reference owner
  -> existing lab/session and ReleaseGate owners
```

The index owns only lane routing, immutable artifact provenance and chain of
custody. It does not copy the existing evidence-capture profile, TestResult,
fixture adapter, target binding, or ReleaseGate records. The fixture adapter
continues to own generic target/electrical/mechanical identity. A future run
continues to own method-specific inputs. `TestResult.rawArtifacts` remains the
sole result-to-artifact reference field.

## Current state

- Exactly one proposed lane: `HIL_RAW_TEST`.
- `acceptedInEvidenceCaptureProfile=false` and `captureRouteState=PENDING_OWNER_EXTENSION`.
- Exactly two method references: `PROPOSED-USB-DATA-OBSERVATION-001` and
  `PROPOSED-CONTROL-STATUS-HIL-001`; both remain `PROPOSED_ONLY` and are not in
  the nine-method catalog.
- The template contains zero artifacts, zero result IDs, no session, no target
  tuple, no fixture binding, no instrument, no calibration and no ReleaseGate
  receipt. `BOARD_TARGET=UNRESOLVED` and all effects are `NONE`.
- The current evidence-capture profile still has only
  `VENDOR_CONTACT`, `BENCHMARK_SELLER`, `LAB_REGISTRY`, and `VENDOR_RESPONSE`.
  This package records the missing HIL lane; it does not edit that profile.

## Artifact contract

When a real owner extension is later approved, each artifact must carry an
explicit repository-relative path, byte length, SHA-256, media type/format,
capture timestamp and source, capture-tool identity/version/config digest,
session/run/TestResult references, clock/timebase/sample/channel metadata when
applicable, operator/custody/readback state, and an explicit original-versus-
derived relation. A derived artifact must point to its source artifact and
derivation configuration. No value is inferred from a filename or extension.

The current template intentionally has no artifacts or results. A template or
synthetic record is never physical evidence and cannot qualify a board, accept
a method, freeze a target, or close a ReleaseGate.

## Adoption sequence (future evidence required)

1. Obtain target/fixture/session and method-owner evidence without changing the
   proposed method IDs.
2. Review a lane/profile extension against the existing evidence-capture
   owner, preserving its four existing lanes and owner-byte policies.
3. Bind a real run and TestResult only after the fixture adapter and target
   tuple are accepted by their owners.
4. Capture original bytes, read them back, seal the index, and let the existing
   TestResult/raw-artifact and ReleaseGate owners evaluate the result.

No step above is performed by this package. Storage power-loss remains outside
this lane and remains pending primary target/storage evidence.

## Verification

```powershell
npm run validate:hardware-hil-raw-evidence-capture
npm run test:hardware-hil-raw-evidence-capture
```

The validator recompiles the closed schemas, checks canonical JSON, method and
source identity, current fixture/method-gap semantics, the four-lane profile,
the unresolved target boundary, live software hardware-impact semantics and
the nine official raw snapshot hashes. The selftest mutates promotion,
provenance, owner, target, lane and implementation fields and keeps any
intentional benign software task progression separate from rejected cases.

Root `package.json` is deliberately not a byte-locked implementation artifact:
the validator checks only the exact HIL npm commands and their ordered
`validate:hardware-rd` placement, so unrelated future scripts do not create
maintenance churn.
