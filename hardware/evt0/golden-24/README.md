# EVT-0 24码黄金切片

本目录是产品、主板/OID筛选、固件、Snapshot和验收共用的逻辑 fixture。

- `codes.json` 固定 24 个逻辑槽位、产品场景、播放策略、音频来源计划和测试 oracle。
- `physicalCode` 当前全部为 `null`，表示目标码生成器和印刷 profile 尚未冻结。
- `codecPlan` 是覆盖目标；精确采样率、码率和解码限制等待 `BOARD_TARGET` 能力证据。
- `negativeCases` 位于 24 个有效映射之外，用于未绑定、空白、普通印刷、坏文件、坏快照和掉电测试。

## 状态

`DESIGN_READY_HARDWARE_BLOCKED`：逻辑切片已经定义，实物发布仍受以下门约束：

1. 两套同 revision 主板/光头；
2. 可封存版本和哈希的码生成工具；
3. 两个独立印刷批次；
4. 目标音频 codec 支持表；
5. 24 个唯一物理码和至少一个未绑定有效码。

给 `physicalCode` 填值时必须保存工具版本、项目文件、输出哈希和印刷批次。不得使用顺序整数假装真实 OID 码。

## Host-only 音频 fixture

```powershell
npm run generate:evt0-host-audio
```

命令会在 `build/evt0-host-audio/` 生成确定性 WAV/MP3 诊断音和带 SHA-256、codec、采样率、时长的 manifest。它用于主机编译器、映射和起播测量工具开发，状态固定为 `HOST_ONLY_NOT_TARGET_RELEASE`；目标音频参数仍由主板能力证据决定。
