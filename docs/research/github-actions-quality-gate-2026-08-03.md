# GitHub Actions 质量门版本记录（2026-08-03）

> 范围：益米仓库 PR 合同门、定时完整回归和机器报告留存。  
> 配置：[`quality-gates.yml`](../../.github/workflows/quality-gates.yml)

本轮通过 GitHub 官方仓库 API 读取最新 release，并解析 tag 到 commit；workflow 固定 commit
而不是浮动主版本：

| Action | 官方 release | 固定 commit |
|---|---|---|
| `actions/checkout` | [`v7.0.1`](https://github.com/actions/checkout/releases/tag/v7.0.1) | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | [`v7.0.0`](https://github.com/actions/setup-node/releases/tag/v7.0.0) | `820762786026740c76f36085b0efc47a31fe5020` |
| `actions/upload-artifact` | [`v7.0.1`](https://github.com/actions/upload-artifact/releases/tag/v7.0.1) | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |

PR/push 执行 workspace test 与 `validate:contracts`；每天定时及手动完整任务安装
`rust-toolchain.toml` 对应的 Arm/RISC-V targets 后执行 `validate:full`。HIL 仍由真实样品
任务产生 receipt，不由云 runner 模拟。
