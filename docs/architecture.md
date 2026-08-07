# Architecture · 益米 Yimi Pen

> 本文描述当前仓库的原型结构。候选方案、目标运行时边界与迁移路线见
> [架构方案探索与比较](./architecture-options.md)。长期依赖方向、合同所有权和变更预算
> 由[高复用、低维护架构](./reuse-maintainability.md)及其机器策略持有。

## Overview

```
┌──────────────┐   protocol    ┌──────────────┐
│ companion /  │◄────────────►│  device-sim  │
│ admin-web    │               │  / firmware  │
└──────┬───────┘               └──────┬───────┘
       │                              │
       │         ┌────────────────────┤
       ▼         ▼                    ▼
 content/*   PointReadEngine     AudioQueue
 packs hub   (@yimi-pen/core)    (@yimi-pen/audio)
       │
       ▼
 optional bridges (MQTT / HA)  ← 米家友好，非官方
```

## Packages

| Package | Role |
|---------|------|
| `@yimi-pen/core` | 幼儿 IP 领域模型 + 点读策略 |
| `@yimi-pen/content` | book.json 读写校验 |
| `@yimi-pen/audio` | 播放与 replace/queue 策略 |
| `@yimi-pen/protocol` | 笔端 JSON 消息 |

## Reuse boundary

当前 packages 是受保护的原型基线；新增整机能力优先进入版本化合同、纯 Rust core、隔离的
use case/adapter 或 App 组合根。跨运行时共同语义使用 Schema/Header/Transcript 复用，
不通过复制常量和另建平行协议复用。依赖图由
[`architecture/system-boundaries.v1.json`](../architecture/system-boundaries.v1.json) 冻结并由
`npm run validate:architecture` 检查。

## Tap pipeline

1. 笔尖上报 `oid` 和/或页坐标  
2. `PointReadEngine.resolve` → Hotspot + playPolicy + clips  
3. `AudioQueue.applyPolicy`  
4. 可选：协议 `play` 通知家长端；MQTT 上报状态  

## Content

```
content/books/<bookId>/book.json     # 已安装书
content/audio/...
content/packs/registry.json          # 社区索引
content/packs/<pack-id>/             # 完整主题包
```

## Protocol (v1)

`hello` `ack` `tap` `play` `stop` `error` `heartbeat`  
见 `packages/protocol/src/messages.ts`。
