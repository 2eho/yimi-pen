# Snapshot lifecycle simulator

这个隔离工具用真实文件、SHA-256、A/B slot、追加式 head record 和故障注入
验证 Content Snapshot v1 的事务语义。SCN-01..09 已冻结在中立的
`hardware/evt0/snapshot-v1/operation-transcript.json`；Node 文件 adapter 和 Rust
`InstallMachine` adapter 分别执行，再逐项比较结果。

```powershell
npm run test:snapshot-sim
```

覆盖：

1. 出厂快照 provision；
2. stage → verify → atomic activate；
3. staging文件损坏；
4. staging中断电；
5. head提交前断电；
6. 第二次成功激活；
7. 活动快照损坏后的 boot rollback；
8. 空间预检；
9. release模式拒绝 design fixture。

模拟器状态严格限制在项目 `build/` 目录。它证明安装契约和故障语义，不等同于目标 Flash/文件系统的实物掉电测试。

比较字段固定为 `active`、`lastGood`、`generation`、`snapshot`、`error`。机器报告：

```text
build/snapshot-sim/node-transcript-result.json
build/snapshot-sim/rust-transcript-result.json
build/snapshot-sim/report.json
```

两条 adapter 共享操作输入和期望结果，不共享状态转换实现。Node 路径执行真实
fixture 文件与 head record；Rust 路径执行目标无关 `no_std` 核心，并只在 host
adapter 中补充 A/B slot 与 generation 持久化模型。
