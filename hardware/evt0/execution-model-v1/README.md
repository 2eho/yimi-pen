# Snapshot ExecutionModel v1

本合同冻结 Snapshot JSON 到目标无关运行表的边界：字符串 `actionId/clipId` 是稳定诊断键，
Rust 运行热路径只使用按 Snapshot 数组顺序生成的零基 `ActionSlot/ClipSlot`。

```text
Snapshot logical-index.json + actions.json
→ parser/semantic closure
→ OidIndex + ActionDescriptor[] + flat ClipSlot[]
→ PhysicalCodeEvent + injected RandomIndexSource + per-action cooldown state
→ playback plan
```

当前 transcript 的 `physicalCode` 来自明确标记的 host surrogate 公式，只验证 parser、slot、
策略与 cooldown；它不是 OID 码工具产物，也不形成实物证据。Family Alpha 使用编译器实际
生成且含 clip catalog 的 Snapshot；Golden-24 design fixture 用 action 引用顺序派生临时 clip
catalog，以单独覆盖 500 ms cooldown。发布 parser 仍要求 Snapshot 自带完整 clip catalog。

Node 与 Rust host parser/planner 独立实现并比较完整 `ExecutionModel + trace`；`yimi-runtime-core`
保持 `no_std`、无分配、无文件系统和板级依赖。目标板 RAM/Flash 编码、真实物理码和两块同版
C/Rust 差分继续由 `BOARD_TARGET` 与 HIL 证据关闭。

## 冻结语义

- `ActionSlot` 按 `actions.actions` 数组顺序稠密分配，`ClipSlot` 按显式 catalog 顺序分配；
  缺 catalog 的 Golden-24 设计夹具按 action/clip 首次引用顺序派生；
- 每个 action 必须被一个 OID 条目引用，OID、action、clip 及 catalog 全部双向闭合；
- `replace` 恰好一个 clip，`queue` 保留全部 clip 顺序，`random_one` 至少两个 clip；
- cooldown 是逐 action 的 accepted-play cooldown；插入其他 action 不会重置它，边界时刻可播放；
- transcript 时间属于同一单调时钟域并按顺序不回退；`valid` 必须带 code，`no-code` 和
  `sensor-fault` 必须不带 code，`low-quality` 可保留被质量门拦下的候选 code；
- `randomIndex` 只在实际执行 `random_one` planner 时出现且只消费一次；
- host surrogate 必须精确等于 `9000000000000000 + logicalOid 数字后缀`，仅用于主机测试。

`order-trap/` 使用刻意非词法排序的 action、catalog 和 action 内 clip 引用，防止实现把数组顺序
误换成字符串排序后仍通过常规编号夹具。

`RandomIndexSource` 注入的是已经选定的最终 clip index；v1 证明确定性选择边界，不证明均匀性、
熵质量或加权算法。旧 Pack 的 `weight` 尚未进入 Snapshot v1，迁移前必须增加版本化字段与分布
黄金向量，不能把当前 `random_one` 结果写成“加权随机已完成”。

ExecutionModel 的 `source` 只锚定 `logical-index.json` 与 `actions.json` 原始字节。Family 场景由
runner 在外层复核编译报告、Snapshot ID 和文件摘要；结果对象自身不是完整 manifest receipt。
目标 parser 的输入边界必须是已通过 manifest/schema/hash/target/capability 校验的 Snapshot，后续
由统一 `EvidenceReceipt` 绑定 manifest、这两个 component hash 和目标 parser 结果。

## 主机交叉验证

```powershell
npm run test:execution-model
```

验证器复核 Family Alpha 实际编译报告和输入文件摘要，随后由独立 Node 实现与 Rust host
实现生成完整模型及轨迹。当前 Family Alpha（6 action / 10 clip / 8 tap）、Golden-24
（24 action / 37 clip / 8 tap）和非词法 order-trap 结果逐字节一致；23 条对称负例验证
parser/planner 拒绝与失败输出不覆盖。报告写入 `build/execution-model-validation/report.json`。
