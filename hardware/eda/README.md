# EDA workspace

本目录保存 Yimi Pen Gen1 的嘉立创EDA研发基线和可审查输出。接入与复检步骤见 [嘉立创EDA Pro × Codex](../../docs/jlceda-codex.md)。

- `source-export/`：每个硬件版本对应的嘉立创EDA源工程快照与可审查导出。
- `reviews/`：ERC/DRC、BOM/网络/封装差异和硬件评审结论。
- `releases/<REV>/`：Gerber/ODB++、钻孔、BOM、CPL、PDF、3D、哈希与制造说明。
- `manifest.json`：当前 EDA 工具、桥接权限和待冻结的板级/BOM revision。

二进制设计快照只做整包版本化，不进行文本式三方合并。原理图/PCB正式发布前必须保留嘉立创EDA版本节点以及 Git 中的制造包哈希。

当前 `BOARD_TARGET=UNRESOLVED` 阶段的可复算逻辑骨架由
[`hardware/evt0/eda-system-skeleton-v1`](../evt0/eda-system-skeleton-v1/README.md) 持有。它只生成 `build/` 下的层级、块、接口登记和SVG预览；本目录的原生源导出、评审与制造发布区继续等待受控 JLCEDA 写入/回读证据。
