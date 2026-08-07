# DeviceLink v1

`DeviceLink v1` 冻结设备管理的**语义层**；USB/UART/BLE 的最终 framing、MTU、
backpressure 和超时仍由 `BOARD_TARGET` 实测决定。

## 1. 当前工件

| 工件 | 作用 |
|---|---|
| [`schema.json`](./schema.json) | `loopback-json-v1` 请求/响应 envelope；每个 operation 都有确定成功 payload |
| [`golden-vectors.json`](./golden-vectors.json) | 单消息 Schema、规范 Base64、路径、十进制 `u64` 和错误映射向量 |
| [`transaction-transcript.schema.json`](./transaction-transcript.schema.json) | 有状态事务 transcript 合同 |
| [`transaction-golden.json`](./transaction-golden.json) | 正向、重放、断连续传、abort/rollback 场景 |
| [`transaction-negative.json`](./transaction-negative.json) | 冲突、offset、越界、CAS、不完整与失败零副作用场景 |
| [`yimi-device-link-core`](../../../firmware/crates/yimi-device-link-core/) | allocation-free Rust 分块/事务/replay journal 核心 |
| [`tools/device-link-sim`](../../../tools/device-link-sim/) | 独立 Node reference handler 与 Node/Rust 差分 runner |

运行：

```powershell
npm run test:device-link-sim
```

报告写入忽略提交的 `build/device-link-sim/report.json`。

## 2. 冻结事务顺序

```text
snapshot.stage.begin
→ manifest.json 按 offset 顺序写入并持久化
→ 校验 manifest 长度、Snapshot canonical hash 与文件表
→ 按 manifest 文件顺序分块写内容
→ snapshot.verify
→ snapshot.activate（再次比较 active CAS）
```

- `manifestByteLength` 是 `manifest.json` 的精确传输长度；
- `totalBytes` 是本事务全部传输文件之和，**包含一次 manifest**；
- `fileCount` 同样包含一次 manifest；
- wire 上的 offset、总量、generation 和 sequence 使用规范十进制 `u64` 字符串，
  避免 JSON/JavaScript 大整数舍入；
- `byteLength` 与 `fileCount` 保持有界整数，具体上限由 capabilities 和板级证据进一步收紧；
- 成功写响应的 `nextDurableOffset` 只在数据与事务 journal 完成 `storage_sync` 后推进。

主机 Rust adapter 使用 transcript 预扫描得到的 `hostManifestSurrogate`，只用于让 Node 与
Rust 消费同一事务输入；它没有被当作量产 manifest parser。真实 parser、canonical hash、
文件顺序与存储持久化在板级 HIL 中复核。

## 3. 幂等与冲突

- 相同 `requestId + 相同已解码强类型请求`：返回第一次**成功**响应，不重复副作用；
- 同一已成功 `requestId` 搭配不同 operation/payload：`REQUEST_ID_CONFLICT`；
- 失败请求不写 replay journal，保证失败零副作用；修复条件后可重试同一 request ID；
- 同一 transaction ID 与相同 begin metadata：恢复当前进度；
- 同一 transaction ID 与不同 metadata：`TRANSACTION_ID_CONFLICT`；
- 相同 `(transactionId, path, offset, byteLength, chunkSha256)` 的 durable range：幂等成功；
- 已落盘 range 的内容不同：`CHUNK_CONFLICT`；
- gap、overlap、加法溢出或超出文件/事务声明：稳定错误且状态不变；
- transport 断连可在同一 boot session 内通过 `status.get` 与 request replay 续传；
- 设备掉电后的 v1 规则仍是 staging 记为 `Aborted`，以新 transaction 重新开始。

Rust request journal 以 `OpaqueRequestId` 保存完整有界 ASCII identity，而不是只保存哈希；
容量和 `RejectNew/EvictOldest` 策略为 const generic，最终数值由板级 RAM 与重连实测决定。

## 4. CAS、abort 与 rollback

- begin 和 activate 都检查 `expectedActiveSnapshotId`；
- activate 只有在 `ReadyToActivate` 且 head record 已持久化后提交语义状态；
- abort 适用于 `Staging/Verifying/ReadyToActivate`，不改 active/last-good；
- rollback 只在无活动 transaction 时执行，并对当前 active 再做 CAS；
- 相同成功 request ID 的 activate/abort/rollback 重放返回首次响应，不再次切换 head。

## 5. 已关闭与仍开放的边界

主机已关闭：

- 16 个 Node/Rust 同 transcript 场景；
- manifest-first、两文件多 chunk、request ID replay/conflict；
- chunk replay/conflict、gap/overlap/out-of-range；
- 两类断连、transaction resume/conflict、verify incomplete；
- begin/activate CAS、abort/rollback replay；
- 11 个非成功步骤的完整状态零副作用；
- Rust core 的 prepare → durable write/sync → commit 两阶段边界。

目标板继续保留：

- 真实 Snapshot manifest parser 与 canonical hash；
- USB/UART/BLE framing、MTU、partial read、BUSY/backpressure；
- replay journal 容量和保留窗口；
- `storage_sync`、torn write、head record 原子单元和掉电窗口；
- Windows/macOS 实际重连；
- 两块同 revision 板上的 C/Rust trace；
- 3 轮 500MB、满盘、碎片化、冷启动与掉电测试。

`packages/protocol` 是既有应用模拟/控制合同，继续与 DeviceLink v1 分离。
