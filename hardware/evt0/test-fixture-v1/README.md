# HW-REUSABLE-TEST-FIXTURE-ARCHITECTURE-V1

This package adds one bounded, target-neutral seam to the mature EVT-0 reading-pen
test path:

```text
stable fixture profile
  -> target adapter
  -> physical fixture instance / fixture-only selftest
  -> existing lab session / TestResult / raw-evidence owners
```

It is not a second lab registry, method catalog, TestResult contract,
ReleaseGate catalog, or evidence-capture owner.

## Contracts

- `profile.json`: the versioned reusable capability profile. It contains exactly
  eight capability IDs. The seven `OPERATIONAL` families partition the 18
  interfaces in `hardware/evt0/hardware-system-v1/topology.json`; the evidence
  anchor is cross-cutting and is not counted as an additional operational family.
- `adapter.template.json`: target adapter identity and seam only. It references
  the exact profile/topology/target-binding identities. `BOARD_TARGET` remains
  `UNRESOLVED`; the full five-tuple and all target-dependent electrical and
  mechanical fields are null or empty pending fields.
- `instance.template.json`: a separate physical-instance placeholder. It
  references the profile, adapter template, and lab registry template separately;
  it does not assert a serial, physical fixture, calibration, qualification, or
  readiness.
- `selftest.template.json`: fixture-only pending checks and minimal owner
  references. It never produces physical evidence, closes a ReleaseGate, or
  promotes target/board state.

The four schemas are Draft 2020-12 closed schemas. Templates are deterministic
UTF-8 JSON and are intentionally pending-only. The validator also checks bytes
and SHA-256 for the package implementation files and all referenced owner files,
so a changed owner or contract fails closed instead of silently drifting.

## Capability coverage and explicit gaps

The operational partition is:

| Capability | Interfaces | Existing coverage |
| --- | --- | --- |
| `CAP-OPTICAL-PRESENTATION-DATUM` | OID optical, head mechanical | ready intake methods |
| `CAP-OID-EVENT-TIMING-OBSERVATION` | OID event | boot/function methods |
| `CAP-POWER-SAFE-INJECTION` | USB power, battery, board power, audio power | existing power methods |
| `CAP-CONTENT-STORAGE-OFFLINE` | storage, wireless | partial; no dedicated storage power-loss method |
| `CAP-USB-DATA-TRANSPORT` | USB data, USB mechanical | pending method and instrument-slot coverage |
| `CAP-AUDIO-ACOUSTIC-OBSERVATION` | audio signal, audio acoustic | reference/target acoustic methods |
| `CAP-CONTROL-STATUS-DIAGNOSTIC-HIL` | control, status, diagnostic, board mechanical, user-IO mechanical | partial; no dedicated control/status method |

`CAP-FIXTURE-EVIDENCE-ANCHOR` is cross-cutting. The profile records the three
known gaps explicitly as `PENDING_METHOD_COVERAGE` or `PARTIAL_COVERAGE`; empty
method/slot arrays are an intentional statement of missing owner coverage, not a
pass.

## Ownership boundary

1. **Profile layer** owns stable capability IDs, abstract slots, references,
   status and evidence policy.
2. **Adapter layer** will own only target-specific mapping after exact five-tuple,
   written supplier evidence and accepted same-revision intake exist. It does not
   predeclare pins, voltage/current, connectors, pogo positions or dimensions.
3. **Instance/selftest layer** owns physical fixture identity and fixture-only
   readiness inputs. Real instrument identity/calibration remains in `lab-v1`.
4. **Existing owners** continue to own method execution, lab sessions,
   `TestResult`, raw artifact capture and ReleaseGate receipts. This package stores
   references and hashes, not copies of those records.

All effects are `NONE`. Synthetic/template evidence is never physical evidence.
The package cannot close a physical ReleaseGate or change `BOARD_TARGET`.

## Validation

```powershell
npm run validate:hardware-test-fixture
npm run test:hardware-test-fixture
```

The validator writes `build/hardware-test-fixture-validation.json`; the negative
selftest writes `build/hardware-test-fixture-selftest.json`. Both are ignored
build reports. The selftest mutates more than 20 independent boundaries,
including identity, coverage, owner references, target-dependent values,
physical claims, synthetic/physical evidence confusion, promotion effects and
revision/hash drift.

The software boundary is read-only and task-name independent: the current
software owner anchor and newest formal report are recorded by identity, while
the explicit hardware-impact report remains authoritative for
`hardwareImpact=NONE`, `BOARD_TARGET=UNRESOLVED`, and the false modification/
qualification/offline flags. No software or software-owner file is written.

## Next physical decision

This package reduces repeated setup and reference drift, but it does not create a
fixture or qualify an instrument. The next hardware actions remain external and
evidence-led: send/freeze MB1 (96), conditional benchmark buy/intake (86), REF2
seller request/capture (85), then physical lab registration (77). Chip-level EDA,
pin selection, power values, connector choice and mechanical dimensions remain
behind the target evidence gate.
