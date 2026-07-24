# Architecture · 益米 Yimi Pen

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
