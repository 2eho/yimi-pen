# WeightedRandom v2

## 结论

此目录冻结点读笔 `random_one` 的**整数权重到具体 clip** 的唯一 v2 语义。它是
Snapshot/Family 编译器与 Rust 固件之间的稳定合同，不修改现有 Pack 公共格式，也不把
host fixture 写成量产证据。

本合同来自三类已核实依据：

1. 仓库产品真值：`Clip.weight` 为可选字段，缺省值是 `1`；现有 JoJo 与 DIY 内容均有
   `2:1` 的 `random_one` 实例；
2. 上游一手实现说明：均匀整数映射要让接受样本空间大小整除目标区间，余数样本被丢弃；
3. 一手论文：arXiv `1805.10941v4` 用作算法研究交叉依据。Yimi 没有照搬其乘法实现，
   而是冻结更便于跨 Node/Rust 审计的低端前缀拒绝法。

精确来源、commit、内容哈希及使用边界在 `evidence-lock.json`。

## 冻结语义

给定数组顺序不变的 `2..32` 个 clip，每个权重为 `1..u32::MAX`：

```text
totalWeight = sum(weights)                       // checked u64
threshold   = 2^64 mod totalWeight
repeat rawWord = next_uniform_u64():
  if rawWord < threshold: reject and continue
ticket      = rawWord mod totalWeight
selected    = first i where ticket < sum(weights[0..=i])
```

- 接受区间是 `[threshold, 2^64)`；其大小恰好是 `totalWeight` 的整数倍；
- 每个 ticket 的原像数量完全相同，避免直接 `rawWord % totalWeight` 的余数偏差；
- clip slot 数值不参与排序，只认数组顺序；
- 半开区间保证边界票落入下一个 clip；
- raw word 用十进制字符串进入 JSON，避免 JavaScript `Number` 精度损失；
- 随机源由板级 adapter 注入，核心不绑定 RNG、HAL、RTOS 或芯片。

## 工件

| 工件 | 作用 |
|---|---|
| `transcript.schema.json` | 输入合同与 fixture/证据边界 |
| `result.schema.json` | Node/Rust 共用结果合同 |
| `golden-transcript.json` | 拒绝、边界、数组顺序、`u32` 最大权重和 `u64` 边界向量 |
| `evidence-lock.schema.json` | 依据锁格式 |
| `evidence-lock.json` | 本地事实和一手来源的固定审计记录 |

执行：

```powershell
npm run test:weighted-random-v2
```

报告写入 `build/weighted-random-validation/report.json`。它只生成 host receipt；
`RG-SNAPSHOT-WEIGHTED-RANDOM-VERIFIED` 继续等待非 fixture Snapshot、目标 RNG provider、
两块同版板卡的原始词流/选择 trace 与可复算分布工件。

