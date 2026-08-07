# Snapshot v1 fixtures

- `schema.json`：Content Snapshot v1 的机器可读结构约束。
- `logical-index.schema.json`：设备 OID 索引投影的结构约束。
- `actions.schema.json`：Action 与可选最小 clip catalog 的结构约束。
- `operation-transcript.schema.json`：中立生命周期 transcript 的结构约束。
- `operation-transcript.json`：由 Node 文件/A-B adapter 与 Rust `InstallMachine` adapter 独立消费的 SCN-01..09 操作和期望结果。
- `design/`：由 24码逻辑 fixture 生成的设计态示例；物理码和目标板保持未冻结。

设计态示例用于编译器、校验器和安装状态机开发。它不是制造/装机发布包。

Schema 负责结构与可表达的 assigned/null、播放策略数量条件；属性级唯一性、十进制
`u64` 上界、assigned 物理码数值升序、跨表引用、manifest 的 index/action 计数和
文件/clip 投影由共享
[`scripts/snapshot-projection-validator.mjs`](../../../scripts/snapshot-projection-validator.mjs)
校验。Family Alpha 与产品基线共同调用该实现；目标 parser 在发布前需用同一负向集合
建立独立实现证据。

Transcript 只冻结稳定的生命周期观测面：`active` slot、`lastGood` slot、已提交
`generation`、当前 `snapshot` 和操作 `error`。故障注入名称属于测试夹具语义，
不代表尚未选定的 Flash 或文件系统实现。
