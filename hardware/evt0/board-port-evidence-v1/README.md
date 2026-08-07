# BOARD_TARGET Rust/C port 证据包 v1

本包用于向候选主板/OID 供应商收集可复算材料。回答“支持 Rust”不构成证据；
每个候选必须建立独立的
[`board-oid-kit` intake](../intake-v1/board-oid-kit.template.json)，并关联两块同
revision 实物的原始 artifact。

## 1. 供应商交付清单

| 类别 | 必交材料 | 接受门 |
|---|---|---|
| 精确身份 | `BOARD_MPN`、`PCB_REV`、`HEAD_MPN`、`HEAD_REV`、两块 serial、正反面照片 | 两块完全同版；差异拆成两个 candidate |
| MCU/BSP | 芯片全型号、datasheet、errata、BSP/RTOS/SDK 名称和固定 revision | 来源、许可证、下载包 SHA-256 可复现 |
| C 工具链 | compiler/linker 版本、target/ABI、link script、启动代码、完整 build/flash/log 命令 | 无 IDE 点击步骤也可从干净目录构建 |
| 固件所有权 | 可链接 SDK/source/static library 及头文件 | OID、音频、存储、USB/transport、clock、log 均可调用 |
| 安全启动 | bootloader、签名、rollback、恢复口、量产烧录边界 | 开发和量产 key/镜像流程分开记录 |
| 供应 | 同 revision 样品和批量生命周期书面说明 | 不以“同系列兼容”替代精确 revision |

## 2. `yimi-platform-ffi v1` port 必答项

供应商或板级工程师应基于
[`yimi_platform_v1.h`](../../../firmware/abi/yimi_platform_v1.h) 提供：

1. `acquire/release` 的原子或中断安全临界区实现；
2. 最终 C compiler 对全部 `sizeof/align/offsetof` 断言的编译日志；
3. Rust target 与 C object 的真实 link/map 文件及两板调用 trace；
4. ISR producer 写 event、release 发布 index、task acquire 读取的代码位置；
5. OID/audio `sequence`、累计 `dropped_events`、queue stats 的 overflow 实测；
6. audio `STARTED.at_us` 属于 request、PCM、DMA 还是 electrical 阶段；
7. storage alignment、max transfer、atomic unit、`sync` 掉电承诺和 torn-write 行为；
8. byte-stream partial read、MTU、BUSY/backpressure、断连重试和零副作用规则；
9. 输入 buffer 返回后异步路径已复制的证据；
10. Snapshot manifest parser、RFC 8785 canonical hash、manifest-first 与文件顺序在目标存储上的一致性；
10. C/C++ exception、`longjmp`、ISR callback 和重入均不跨 Rust ABI。

## 3. 两块同版样品的执行顺序

```text
身份封存
→ 供应商 C reference build/flash/boot
→ platform ABI layout/link probe
→ Rust locked build/flash/boot
→ OID/audio/storage/transport shared vectors
→ queue overflow + power-cut + reconnect faults
→ 24码 × 2 heads × 2 print batches
→ C/Rust normalized trace diff
→ TestResult v1 原始样本/queue stats/哈希复算
```

同一 binary SHA-256 必须在两块样品上启动。每次测试保存 tool version、命令、
exit code、board/head identity、固件 hash、`Cargo.lock` hash、原始 log/logic/audio
文件 hash。`request-accepted` 不进入固件输出 P95；声学首音由外部仪器确认。

## 4. 决策输出

- 全部门通过：candidate 可进入 `BOARD_TARGET` 冻结评审；
- C reference 通过而 Rust/ABI 未通过：保留为成熟参考，不进入益米第一方固件路线；
- 两块 revision 不一致、队列丢失不可观测或 sync 语义含糊：保持证据缺口，继续换样或换 candidate；
- 任何 NO-GO 都保留原始 artifact 与原因，不用口头承诺覆盖。

机器检查入口：

```powershell
npm run validate:evt0-intake
npm run validate:firmware-contracts
npm run validate:rust-firmware
```
