# ExecutionModel v1 Node/Rust 黄金交叉验证

本目录为 Snapshot ExecutionModel v1 提供独立 Node 参考实现与交叉验证 runner。

## 输入

- Family Alpha：`build/family-alpha-validation/snapshot/` 的实际编译产物，并复核其
  `report.json` 中的文件大小、SHA-256、Snapshot 身份与确定性证据；
- Golden-24：`hardware/evt0/snapshot-v1/design/` 设计快照；
- transcript 与结果 Schema：`hardware/evt0/execution-model-v1/`；
- Snapshot 源 Schema：`hardware/evt0/snapshot-v1/`。

Family Alpha runner 依赖已完成的黄金编译结果。独立运行前先执行：

```powershell
node tools/family-alpha-compiler/run-golden.mjs
```

## 独立性

`model.mjs` 自行完成：

1. Snapshot 与 transcript 解析、Schema 验证；
2. action/clip 稠密 slot 分配；
3. physical-code surrogate 索引闭包；
4. replace、queue、random_one 与逐 action cooldown；
5. trace 和完整 ExecutionModel 生成。

Node 结果先由合同和输入独立生成，随后 runner 通过 locked Cargo build 调用
`yimi-fw-host execution-model`。Rust 输出只用于最终完整对象比较，不参与 Node 期望生成。

## 执行

```powershell
node tools/execution-model/run-crosscheck.mjs
```

输出位于 `build/execution-model-validation/`：

- `node/*.json`：Node 独立结果；
- `rust/*.json`：Rust host 结果；
- `negative/*`：23 条负例输入及保持原字节的 sentinel 输出；
- `report.json`：输入、工具链、模型、轨迹、负例与证据边界报告。

runner 使用 `build/.execution-model-validation.lock` 防并发，并且只清理带精确 marker 的
`build/execution-model-validation/`。

当前黄金覆盖：Family Alpha 6 OID / 6 action / 10 clip / 8 tap；Golden-24
24 OID / 24 action / 37 clip / 8 tap；另有 3 action / 5 clip 的非词法 slot-order trap。
23 条负例同时要求 Node 与 Rust 拒绝，且输入和失败
输出保持零副作用。

## 证据边界

transcript 中的 physicalCode 是明确标记的 host surrogate，并非真实 OID 码。当前结果证明
主机端两套独立 parser/planner 的合同一致性；目标编码、RAM/Flash、目标板执行、真实物理码
以及两块同版 HIL 继续由各自证据门关闭。
