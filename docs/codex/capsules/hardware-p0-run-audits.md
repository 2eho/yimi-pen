# Capsule: hardware-p0-run-audits

- Memory ID: hardware-p0-run-audits
- Memory class: historical-evidence
- Scope: Gen1 EVT-0 已结算运行审计；当前路线仍由 `docs/codex/active-task.md` 持有。
- Wake-up route: `index.md` -> `hardware-p0-history`

## Run Audit - 2026-07-26 - EVT-0 route correction

- Verdict: yellow
- Verdict reason: The repository route now matches the user's product-equivalence requirement, but exact OID module MPN/protocol evidence and physical build results are still pending.
- Next exact step: Lock two same-revision current integrated mainboard/OID kits and their mechanical/electrical/firmware/print evidence into `BOM-REV-A`.
- ExecutionPolicy / active anchor: `lite-anchor` / this file.
- Task scope: Hardware architecture, single-buy procurement, product-equivalence contract and acceptance planning.
- Touched modules / protected not touched: Hardware/research/firmware documentation and memory; stable application packages were not touched.
- Route drift / repeated failed path: The custom YimiDot camera route was removed; the custom ESP32 board was demoted from default target to gated fallback after the user prioritized current production mainboards.
- Artifact discipline: Existing mature-product and RFQ artifacts were reused; no repeated network probe or speculative supplier claim was added.
- Encoding check: UTF-8 decode and mojibake scan passed for all touched Markdown/CSV files; existing Markdown hard-break spaces were preserved.
- Memory hygiene: The correction replaced the active task route and was kept specific to Gen1 EVT-0.
- Tests/evidence: `git diff --check`, UTF-8/mojibake, code-fence, table-column, relative-link and BOM CSV schema/status checks passed; rejected-route search finds only intentional exclusion/history text.
- Memory writes: Replaced stale active route; refreshed current-context and index route in the same work unit.
- Owner route: `hardware-p0`.
- Upgrade candidate / decision: `project-memory`.

## Run Audit - 2026-07-26 - embedded CLI/MCP survey

- Verdict: green
- Verdict reason: The survey produced a route-specific shortlist without changing the frozen hardware architecture or installing MCU-specific/global tooling prematurely.
- Next exact step: Install only Phase A route-neutral tools and create an isolated hardware-test Python environment; keep ESP-IDF, PlatformIO, Zephyr, KiCad and debugger MCPs deferred until the board branch is known.
- ExecutionPolicy / active anchor: `lite-anchor` / this file.
- Task scope: Embedded CLI, MCP, GitHub ecosystem, audio/test/EDA automation and current workstation readiness.
- Touched modules / protected not touched: Added research documentation and a read-only tool doctor; stable application packages and runtime code were not touched.
- Route drift / repeated failed path: The provider web-search gateway returned HTTP 404, so primary-source research used authenticated GitHub CLI/API, official repository files and direct official documentation pages. Initial PowerShell inventory one-liners twice used an invalid bare pipeline after `foreach`; both were replaced with explicit array collection and left no artifact changes.
- Artifact discipline: Official/vendor sources were preferred; third-party serial/KiCad/GDB MCPs were explicitly graded as conditional or deferred. No MCP server, compiler, SDK or global dependency was installed.
- Encoding check: New Chinese Markdown and PowerShell files decode as UTF-8; mojibake, table-column and relative-link checks passed.
- Tests/evidence: `git diff --check`; PowerShell AST parse; `check-embedded-tools.ps1` text and JSON modes; Markdown relative-link/table/UTF-8 checks.
- Memory hygiene: The tooling choices are scoped to Gen1 EVT-0 and preserve the integrated-mainboard-first route; they are not elevated into a project-wide mandate for unrelated work.
- Memory writes: Updated active task, current context and index artifacts in the same work unit.
- Owner route: `hardware-p0`.
- Upgrade candidate / decision: none.

## Run Audit - 2026-07-26 - review findings closure

- Verdict: green
- Verdict reason: All six recorded review findings were repaired, the stale-route scans are clean, and the final read-only checklist returned `No findings.`
- Next exact step: Install only the route-neutral Phase A tools (`uv`, isolated pytest/pyserial, FFmpeg/ffprobe and pinned Playwright CLI), then obtain two purchasable same-revision 2024-2026 integrated mainboard/OID kits and freeze or reject `BOARD_TARGET + OID_TARGET_HEAD` from evidence.
- ExecutionPolicy / active anchor: `lite-anchor` / this file.
- Task scope: Integrated-mainboard-first documentation consistency, firmware boundary, measurement observability, single-buy table, RFQ identity/versioning and BOM evidence gates.
- Touched modules / protected not touched: Hardware, firmware and research documentation, BOM lock ledger and memory; `packages/core`, `packages/audio`, `packages/content`, `packages/protocol` and app runtime paths remain untouched.
- Route drift / repeated failed path: No new route drift. The earlier module-first/custom-PCB wording was removed or made explicitly conditional on complete integrated-board failure.
- Artifact discipline: RFQ v0.2 now quotes the complete same-revision board/head kit first, requires board/head/firmware identity and a quantified “fourth-generation” baseline, and keeps module-only offers in the new-revision self-board branch.
- Encoding check: All 38 Markdown files decoded as UTF-8; mojibake, code-fence, table-column and relative-link checks passed.
- Tests/evidence: `git diff --check`; 38-file Markdown audit; 13-row BOM schema/state audit; stale-route scan; PowerShell tool-doctor parse/smoke; exact six-finding checklist; protected-path check. Final review output: `No findings.`
- Memory hygiene: This audit records closure of the existing hardware work unit and does not turn temporary review mechanics into project policy.
- Memory writes: Updated the active anchor in the same work unit; current-context next step remains valid.
- Owner route: `hardware-p0`.
- Upgrade candidate / decision: none.

## Run Audit - 2026-07-26 - Phase A host tooling

- Verdict: yellow
- Verdict reason: Phase A tooling and its dedicated smoke tests pass, but the repository-wide `npm test` remains red because the pre-existing `packages/core` test script references `packages/core/node_modules/jest/bin/jest.js` while Jest is neither declared nor installed there.
- Next exact step: Screen and buy two same-revision current integrated mainboard/OID kits; do not install ESP-IDF, PlatformIO, Zephyr, KiCad or debugger MCPs before the board branch is known.
- ExecutionPolicy / active anchor: `lite-anchor` / this file.
- Task scope: Route-neutral Windows host tooling, reproducible locks, isolated serial-test environment, audio CLI and browser CLI.
- Touched modules / protected not touched: Root dev dependency/scripts, `.gitignore`, new hardware test/tool artifacts and tooling research/memory. No file under protected packages or app runtime paths was edited.
- Route drift / repeated failed path: The first BtbN FFmpeg release download exceeded the five-minute command timeout and left a zero-byte asset; the completed uv asset was reused, while FFmpeg switched to the smaller Gyan release build and passed its published SHA-256. npm initially invoked Windows PowerShell 5.1, which misread UTF-8 Chinese scripts; entrypoints now use PowerShell 7 `pwsh`. The repository-wide Jest failure was observed and preserved rather than changing the protected package.
- Artifact discipline: `hardware/tools/phase-a-toolchain.lock.json`, `hardware/tests/uv.lock` and root `package-lock.json` pin sources, versions, hashes/integrities and dependencies. Tool binaries stay outside the repository.
- Encoding check: PowerShell 7 parses both UTF-8 scripts; 42 Markdown files, TOML, JSON and lock files passed encoding/structure checks.
- Tests/evidence: uv `0.11.32`; FFmpeg/ffprobe `8.1.2`; Playwright CLI `0.1.17` browser open/snapshot/close; pyserial loopback `1 passed`; FFmpeg 16kHz mono WAV smoke; `npm run typecheck`; `npm run validate:books`; `npm run tools:doctor` reports `16/17` ready with only later-stage `sigrok-cli` absent; `git diff --check`; PowerShell AST; protected-path check. Known failure: root `npm test` missing Jest in protected `packages/core`.
- Memory hygiene: The installed set remains scoped to route-neutral Phase A; no MCU, EDA or debugger stack was inferred from convenience.
- Memory writes: Updated active task, current context and index in the same work unit.
- Owner route: `hardware-p0`.
- Upgrade candidate / decision: none.

## Run Audit - 2026-07-26 - executable purchase queue

- Verdict: green
- Verdict reason: The procurement research is now reduced to a machine-readable 21-row queue that separates buy-now benchmarks, seller-gated board kits, board-dependent parts and prohibited premature purchases.
- Next exact step: Order `REF1-REF3`, borrow or defer `REF4`, and send the `MB1` evidence gate before paying for two same-revision board/OID kits.
- ExecutionPolicy / active anchor: `lite-anchor` / this file.
- Task scope: Gen1 EVT-0 single-unit purchasing only; no component or architecture downgrade.
- Touched modules / protected not touched: Procurement documentation, `hardware/evt0` execution artifacts and memory; application packages and runtime code were not touched.
- Route drift / repeated failed path: The web search provider again returned HTTP 404, so existing same-day research was reused and current official/retail/Ztron pages were checked directly; no speculative marketplace SKU was promoted into the BOM.
- Artifact discipline: Reused `mature-products-gen1-p0.md` and `gen1-evt0-single-buy.md`; added one executable CSV rather than another independent architecture document.
- Encoding check: All touched Chinese Markdown/CSV files decode as UTF-8 with no mojibake markers; CSV header, 21-row count, unique IDs and status enum passed.
- Memory hygiene: The user request was kept as the next purchasing work unit and did not become a project-wide procurement rule.
- Tests/evidence: Python UTF-8/CSV schema validation, PowerShell `Import-Csv`, `git diff --check`, and direct HTTP 200 checks for the current JoJo retail page, X8 Pro official page and Ztron solution page.
- Memory writes: Updated active task and current context in the same work unit.
- Owner route: `hardware-p0`.
- Upgrade candidate / decision: none.

## Run Audit - 2026-08-03 - JLCEDA EPIPE launcher repair

- Verdict: green
- Verdict reason: 本机堆栈定位到嘉立创EDA主进程默认日志writer的`console.warn -> writeSync`，对应启动父进程已经退出；这不是原理图、PCB或bridge数据错误。
- Next exact step: 当前会话保存工程并正常退出一次；下次由`npm run eda:doctor`启动，stdout/stderr会写入持久日志文件，不再依赖短生命周期终端管道。
- ExecutionPolicy / active anchor: `lite-anchor` / this file.
- Task scope: 嘉立创EDA本地启动可靠性；不改变工程、扩展、MCP权限或产品架构。
- Touched modules / protected not touched: 仅`scripts/check-jlceda-codex.ps1`启动句柄；bridge仍限定`127.0.0.1:49620`与既有只读scopes，稳定产品源码和EDA工程未改。
- Route drift / repeated failed path: 直接从捕获型短生命周期shell启动Electron GUI会留下随后关闭的console pipe；改为每次启动绑定独立持久stdout/stderr文件。
- Artifact discipline: 启动日志落到`%LOCALAPPDATA%\LCEDA-Pro\codex-launch-logs\`，doctor报告仍为`build/jlceda-bridge-status.json`。
- Encoding check: PowerShell AST与`git diff --check`通过。
- Tests/evidence: 隔离句柄fixture捕获stdout且stderr为0字节；`npm run eda:doctor`的可执行文件、Node 24、MCP注册、只读scopes、loopback listener和两端bridge连接全部PASS；密封`npm run validate:full`通过。
- Memory hygiene: EPIPE复现与启动句柄修复属于硬件工具链的可复用失败路径，不提升为产品运行时规则。
- Memory writes: 本审计写入硬件任务锚点；产品下一步与采购路线保持不变。
- Owner route: `hardware-p0`.
- Upgrade candidate / decision: none.
