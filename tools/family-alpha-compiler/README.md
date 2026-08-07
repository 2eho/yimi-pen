# Family Alpha Compiler

`compiler.mjs` 是 WP-05 的隔离主机端编译器，把 Alpha `CompileDraftProjection` 经精确预览确认投影为 Snapshot v1。该 draft 是 `FamilyRevision + BuildRequest + resolved assets` 的兼容投影，不作为 FamilyRepository 持久聚合。编译器不修改现有应用包，也不承担 DeviceLink 传输或目标板播放。

产品合同见 [`docs/family-alpha-v1.md`](../../docs/family-alpha-v1.md)，输入夹具见 [`hardware/evt0/family-alpha-v1`](../../hardware/evt0/family-alpha-v1/)。

## API

模块导出三个异步入口：

```js
import {
  buildPreview,
  writePreview,
  compileSnapshot,
} from "./tools/family-alpha-compiler/compiler.mjs";
```

| 入口 | 作用 |
|---|---|
| `buildPreview({ repoRoot, draftPath })` | 校验 draft/音频并返回 `{ draft, preview }` |
| `writePreview({ repoRoot, draftPath, outputPath })` | 生成 preview receipt 并写为 JSON |
| `compileSnapshot({ repoRoot, draftPath, confirmationPath, outputDirectory })` | 重算 preview、验证 fixture 确认并生成 Snapshot |

典型调用顺序：

```js
const { preview } = await buildPreview({ repoRoot, draftPath });
// 家长端展示 draft 内容并实际播放 preview 对应的音频；
// 用户确认后，持久化绑定 preview.previewId/sourceSha256 的 confirmation。
const report = await compileSnapshot({
  repoRoot,
  draftPath,
  confirmationPath,
  outputDirectory: `${repoRoot}/build/family-alpha/snapshot`,
});
```

预览 receipt 是家庭域展示合同与内容身份凭据，不是 UI 已播放或用户已确认的证明。它携带 `presentationPolicyVersion`、`logicalOid`、标签、transcript、播放策略和有序 clip 元数据，供产品界面按同一版本展示与预听。产品接入方负责实际展示、预听和落地确认事件；编译器负责校验确认是否仍精确匹配当前 draft、展示顺序与音频。

`fixtureOnly: false` 需要家庭协调层先定义签名、身份/设备绑定、防重放和审计证据的 trust contract。该合同尚未冻结，当前编译器直接拒绝非 fixture 确认，不提供可由调用方随意返回 `true` 的占位信任接口。

## 编译门

编译器当前执行以下关键检查：

1. draft、preview、confirmation 与 Snapshot Schema；
2. Alpha 最多 24 个 binding（对应当前黄金产品切片，不外推为设备容量）；
3. binding/action/logical OID/clip 唯一性和播放策略语义；
4. draft、confirmation、音频的 `realpath` 仓库/草稿目录边界及普通非符号链接文件；
5. WAV 为 canonical 44-byte header、单一 `fmt `/`data`、PCM16/16 kHz/mono；RIFF/data 长度、byte rate 和 block align 精确一致，拒绝 metadata 与 trailing bytes；
6. `physicalMapStatus` 与 `physicalCode` 一致；
7. Alpha 只签发 `design-fixture`；任何 `release-candidate` 等待机器可读 release-gate receipt；
8. confirmation 的 `fixtureOnly`、`previewId`、`sourceSha256` 与当前输入一致；
9. 非 fixture confirmation 在正式 trust contract 落地前保持拒绝；
10. confirmation JCS 语义 SHA-256 进入 manifest evidence，原文件 SHA-256 仅进入主机报告；
11. 预览后再次读取的音频大小/SHA-256 不漂移；
12. 编译器自有 producer、源码 SHA-256及输出文件的精确大小/SHA-256；
13. 输出目录是仓库 `build/` 下尚不存在的新目录。

Alpha 阶段的 `build/` 限制是有意保留的防覆盖边界。`writePreview` 使用临时文件加 no-overwrite link 发布；`compileSnapshot` 使用独占 `.compile-lock`，在自有 staging 目录构建并核验后以 rename 发布。并发写同一输出时只会留下一个完整输出；失败清理 staging/lock，已有输出保持原样。

Draft 的 `sourceProducer` 只说明内容编辑来源。Manifest/report 的 `producer` 使用编译器常量，报告另含 `compilerSourceSha256`，避免由输入伪装构建工具身份。

## 输出

```text
build/<run>/snapshot/
  manifest.json
  logical-index.json
  actions.json
  audio/
    <clipId>.wav
```

- `logical-index.json`：`physicalCode / logicalOid / actionId` 投影；
- `actions.json`：播放策略、clip 顺序和 clip 文件 catalog；
- `audio/`：经确认的最终播放 WAV；
- `manifest.json`：目标、revision、逐文件大小/SHA-256、容量和 staged-atomic 安装要求。

编译报告返回 source/preview/confirmation/Snapshot 身份、confirmation 语义/文件双哈希、LF 规范化编译器源码哈希、binding/clip 数、容量、manifest 哈希、文件清单和隐私布尔值。当前 `design:` 输出只投影 DeviceLink 的 manifest-first 参数并由发布 Schema 拒绝；证据门关闭后的 `sha256:` 发布 Snapshot 才交给 DeviceLink 执行 `stage → verify → activate`，不增加直接覆盖 active 的旁路。

## 回归

```powershell
npm run test:family-alpha-compiler
```

Runner 先用 `golden-assets.mjs` 逐字节复算 10 个 WAV，再验证黄金 preview 的对象/字节精确匹配与受限写出、confirmation LF/CRLF 语义身份一致、24-binding 上限、生产信任门、两次独立编译的报告与输出树确定性，以及输入越界、确认漂移、WAV trailing/格式错误、重复 JSON key、已有/并发输出等 27 个负向场景。当前结果为 27/27 通过、27/27 失败零副作用；确定性树通过。机器报告写入 `build/family-alpha-validation/report.json`，并验证 manifest-first DeviceLink 参数投影及发布 Schema 对 `design:` ID 的预期拒绝；发布与物理证据门保持关闭。

Runner 只清理带精确 ownership marker 的专用 `build/family-alpha-validation/`，并以
runner lock 排除并发执行；它不清理 API 示例使用的 `build/family-alpha/` 或其他构建产物。

重建已提交的短时黄金 WAV：

```powershell
npm run generate:family-alpha-assets
```

## 隐私投影

设备输出保留最终确认音频，但不携带原始录音样本、VoiceProfile/voice model、家庭照片、云凭据、标签、transcript 或 `sourceKind`。这些内容留在家庭编辑域；最终家庭录音 WAV 仅作为播放 clip 入包。Runner 会遍历 manifest/actions/logical-index 全部设备 JSON，执行字段白名单、`evidenceRefs` 值格式白名单和家庭源私密值扫描，并用 manifest 私密键、普通私密值与单字中文私密值注入自检覆盖 manifest 泄漏路径。

## 当前夹具与物理边界

黄金输入是 `fixtureOnly: true` 的主机设计夹具：逻辑 OID 为 `YIMI-EVT0-013` 至 `YIMI-EVT0-018`，所有 `physicalCode` 均为 `null`。真实生产确认记录使用 `fixtureOnly: false` 并绑定实际预听版本，不复用黄金记录。

Family Alpha 编译器当前只生成 `design:` Snapshot。`release-candidate` 在机器可读 release-gate receipt 落地前被拒绝；真实 confirmation 在家庭协调层 trust provider 落地前也没有生产信任结论。

当前编译结果不证明以下事项：

- `BOARD_TARGET` 与固件最低版本；
- 真实 OID 物理码和印刷/读取；
- 目标设备 codec 与声学表现；
- 真实 USB framing、重连和吞吐；
- 目标存储同步、掉电、A/B 激活/回滚；
- 笔端离线点读结果。

这些结论由 DeviceLink 板级实现和同 revision 实物测试记录补齐。
