# TestResult v1

`TestResult v1` keeps raw point-read evidence reproducible across the supplier
C reference path and the Rust product path.

- Every physical record seals board/head/firmware/tool/print identities.
- Firmware identity includes the Rust compiler, target triple, binary digest,
  `Cargo.lock` digest, and enabled features.
- Missing phases remain `null`; inferred timestamps are excluded.
- Every sample carries OID/audio sequence and cumulative dropped counters; the
  run also seals final queue stats so a last-event overflow is still visible.
- Cross-clock latency requires an explicit synchronization method and uncertainty.
- Percentiles use nearest rank: sorted `x[ceil(p*n)-1]`.
- A result repeats the frozen test catalog thresholds, and the validator checks
  for drift before calculating the verdict.
- `SYNTHETIC` vectors validate the contract only and never close a physical gate.
- Physical release evidence uses `fixtureOnly=false` and `evidenceState=MEASURED`.

`EVT0-FW-LATENCY` measures firmware event to device audio start.
`EVT0-SYSTEM-LATENCY` measures the observable sensor boundary to acoustic start.
Both remain separate so an internal timestamp is not presented as acoustic proof.

`method.audioStartTimeClass` freezes what `stages.audioStart` means. An
`EVT0-FW-LATENCY` PASS accepts `decoder-first-pcm`, `dma-first-buffer`, or
`electrical-output`. `request-accepted` is diagnostic timing only and is excluded
from the firmware-output P95. Acoustic start remains an external-instrument stage.
Any provider queue drop or unconsumed end-of-run event prevents a PASS instead of
silently shrinking the reliability or latency denominator.
