# Release gate tools

- `refresh-catalog.mjs`：从当前 adapter、legacy inventory 和语义文件原始字节重算 catalog hash/identity；默认检查，`--write` 才更新；
- `run-conformance.mjs`：Catalog/Receipt/Decision Schema、语义身份、legacy alias 和21条零副作用负例；
- `evaluate-current.mjs`：把 canonical adapter 表中的 host reports 转成 receipt，合并外部物理
  receipt，并生成唯一当前 ReleaseDecision；它只读取最近一次密封 host run 绑定的源码集合与报告 hash；
- `run-product-rd.mjs`：独占运行完整产品回归，证明14份 host report 均在本轮刷新且源码集合零漂移，
  写入 `build/release-gate-host-run.json` 后再评价；
- `source-set.mjs` / `host-run-provenance.mjs`：共享源码集合身份与密封 run 语义；
- `catalog-semantics.mjs`：复核 catalog 绑定的 Schema、判定、适配和 evaluator 原始字节；
- `list-blockers.mjs`：仅为尚未完全迁移的报告提供 catalog scope 视图，不创建第二套 gate ID；
- `report-adapter.mjs`：无 I/O 的 JSON Pointer 条件和 host report → receipt 适配函数。

Conformance/current runner 只清理各自带精确 marker 的 `build/` 子目录；full runner 只原子替换
密封 manifest。三者均用独占 lock 防并发。物理 receipt 由板级/制造/信任 producer 生成；本工具
不从 host 通过项推断物理 PASS。
