# WeightedRandom v2 host validator

`run-validation.mjs` validates the reviewed transcript and evidence lock, maps existing Pack/DIY
weights without changing stable product code, runs independent Node and Rust implementations,
checks exact distribution arithmetic, and proves negative failures leave inputs/outputs unchanged.

The report is host evidence only. Target RNG quality, physical-board traces and a production
Snapshot remain separate release evidence.

