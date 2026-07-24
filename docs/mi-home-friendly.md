# 米家友好说明 · Mi-home Friendly

> **重要**：益米点读笔 **不是** 小米/米家官方配件，**未** 加入米家认证计划。  
> 「米家友好」仅表示社区可选的互操作设计，方便已有智能家居的用户。

## 我们做什么

| 能力 | 说明 | 官方米家？ |
|------|------|------------|
| 本地状态 HTTP | 笔/网关暴露 `GET /status`（播放中、电量、当前书） | 否 |
| MQTT 桥 | 主题如 `yimi/pen/<id>/state` | 否 |
| Home Assistant | MQTT discovery 或 REST 传感器示例 | 否 |
| 自动化灵感 | 「开始听故事 → 调暗儿童房灯」由用户自建 | 否 |

## 我们不做什么

- 不内置小米云账号登录  
- 不使用需保密的米家私有协议逆向作为默认依赖  
- 不在包装/README 主标题使用小米官方 Logo 或「米家生态链」表述  
- 不暗示「小米出品」或「官方适配」  

## 品牌表述规范（社区必须遵守）

**可用**

- 益米点读笔  
- 支持 Home Assistant / 本地 MQTT  
- 米家友好（社区桥接，非官方）  

**避免**

- 米家点读笔、小米益米、生态链爆款（易构成混淆）  
- 未授权的 MI  logos  

## 可选状态载荷（草案）

```json
{
  "deviceId": "yimi-pen-001",
  "online": true,
  "battery": 86,
  "bookId": "jojo-bedtime-01",
  "mode": "free",
  "playing": true,
  "hotspotId": "hs-jojo",
  "ts": 1710000000000
}
```

MQTT 示例主题：

```
yimi/pen/+/state
yimi/pen/+/event/tap
yimi/pen/+/cmd/stop
```

实现可放在未来的 `apps/bridges/mqtt-bridge`，默认关闭。

## 合规建议

若未来申请任何厂商官方认证，另开分支与法务流程；主线保持 **厂商中立 + 开放桥接**。
