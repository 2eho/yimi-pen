# Phase A host tools

This directory records the reproducible host-tool boundary used before a target
mainboard or MCU is frozen. Tool binaries are installed outside the repository
and are not redistributed here.

- Machine-readable versions and hashes: `phase-a-toolchain.lock.json`
- Python hardware-test dependencies: `../tests/uv.lock`
- Node browser CLI dependency: root `package-lock.json`
- Readiness check: `npm run tools:doctor`
- Hardware smoke tests: `npm run test:hardware`

ESP-IDF, PlatformIO, Zephyr, KiCad and debugger MCPs are intentionally absent
until the corresponding hardware branch is selected.

