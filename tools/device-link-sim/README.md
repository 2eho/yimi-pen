# DeviceLink v1 host transaction simulator

Run with:

```powershell
node tools/device-link-sim/run-transcript.mjs
```

The runner validates both transaction transcript fixtures, validates every
request and generated response against the frozen DeviceLink v1 envelope schema,
executes them independently through the Node reference handler and Rust
`yimi-device-link-core` adapter, then compares every step and final state. It also
checks the required coverage set and every non-success zero-side-effect invariant.
Deterministic adapter outputs and the comparison report are written under
`build/device-link-sim/` (ignored by Git).

Storage durability, response loss, reconnect, and power/disconnect boundaries in
this tool are host simulations. The fixtures freeze transaction semantics only;
they do not set a physical frame size, MTU, timeout, retry count, cache capacity,
or board storage limit. The Rust adapter derives a complete `FileSpec` sequence
from each scenario before execution; this is explicitly a host manifest
surrogate, not a replacement for verified Snapshot v1 manifest parsing on a
device.
