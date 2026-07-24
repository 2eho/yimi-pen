# Firmware · 益米笔固件说明

本目录存放益米点读笔固件相关说明（源码可后续接入具体 SoC/RTOS）。

## 职责

| 层 | 职责 |
|----|------|
| 传感 | OID / 定位 |
| 协议 | 对齐 `packages/protocol` |
| 本地包 | 社区主题包离线存储 |
| 播报 | 本地解码；可上报 tap |
| 可选桥 | 局域网状态（米家友好，非官方） |

## 联调

优先 `apps/device-sim`，再映射实机。

## 环境变量语义

- `PEN_SIM_PORT` / 实机 BLE 服务  
- `PEN_SIM_DEVICE_ID` / 出厂 SN（建议 `yimi-pen-xxxx`）  
