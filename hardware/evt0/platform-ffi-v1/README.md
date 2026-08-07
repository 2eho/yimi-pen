# `yimi-platform-ffi v1`

本目录冻结益米固件 Rust 产品核心与板级 C/BSP 之间的最窄接口合同。

## 文件

- `schema.json`：中立黄金向量的 JSON Schema；
- `golden-vectors.json`：ABI 布局、OID、音频路径、存储和 DeviceLink 字节流向量；
- C 头文件：[`firmware/abi/yimi_platform_v1.h`](../../../firmware/abi/yimi_platform_v1.h)；
- 独立 C 参考 mock：[`firmware/abi/yimi_platform_mock.c`](../../../firmware/abi/yimi_platform_mock.c)；
- Rust 安全适配器：[`firmware/crates/yimi-platform-ffi`](../../../firmware/crates/yimi-platform-ffi/)。

## 验证模型

`golden-vectors.json` 同时经过三层检查：

1. Node/Ajv 对 Schema、向量 ID、十进制 `u64`、状态和路径语义做独立检查；
2. `cc` 把 C mock 作为 C11 单元独立编译，header 内的 `_Static_assert` 固定四个 ABI 结构的尺寸、对齐关系和关键 offset；
3. Rust 测试从同一 JSON 读取输入，经 C mock 和真实 `extern "C"` 边界执行，再比较安全 Rust 输出。

这组结果属于 `fixtureOnly=true` 的主机合同证据。目标板 port 还需用相同向量替换 C mock，附上两块同 revision 板的构建、刷写、原始 trace 和 `TestResult v1`。

## 并发与生命周期

- `acquire/release` 由 C provider 的原子或临界区保证进程内唯一所有权；
- `Platform` 不实现 `Clone/Copy/Send/Sync`，一个 Rust-owned task 以 `&mut` 发起调用；
- C ISR 只采样时间并入队，随后由 poll API 取出；
- ISR 完整写入 event 后以 release 发布队列索引，task 以 acquire 读取，或双方使用同一中断安全临界区；
- OID event 含 `sequence` 和累计 `droppedEvents`，结束时再读 queue stats，队列溢出不会静默进入成功率分母；
- 输入 buffer 只借用到函数返回，异步音频或传输实现先复制；
- C 层不从 ISR 回调 Rust；
- 路径只接受 ASCII 字母数字、`.`、`_`、`-`、`/`，并拒绝空段、`.`、`..`、绝对路径和盘符。

## 时间、存储与传输语义

- `event_at_us` 必填；`UINT64_MAX` 只表示不可用，带 optional flag 的时间也不得使用该 sentinel；
- audio event 显式携带 timestamp class；当前 mock 是 `request-accepted`，不计入固件输出或声学首音 P95；
- `storage_write OK` 表示全量接收，`storage_sync OK` 表示之前写入在随后掉电/复位后仍可读取；mock 会在 power-cycle 时丢弃未 sync 写入；
- DeviceLink transport 是 byte stream；一次 read 可返回前缀并保留余量，`transportMtu` 是单次调用上限；
- `BUSY`、`INVALID_ARGUMENT`、`UNSUPPORTED` 保持零可观察副作用。

运行：

```powershell
npm run validate:firmware-contracts
npm run validate:rust-firmware
```
