# EVT-0 Evidence Intake v1

本目录把“成熟产品已经很成熟，所以要依据前行”落实为结构化样品记录。

## 文件

- `schema.json`：通用 intake 结构；
- `benchmark-product.template.json`：竞品/对标整机；
- `board-oid-kit.template.json`：两套同 revision 主板/OID 套件。
- `sample-record.template.json`：每件实物独立的五元组、serial/lot和原始artifact manifest片段。

## 使用步骤

1. 为每个实际 SKU/kit 复制模板并改成唯一 `intakeId`；
2. 到货前字段保持 `PENDING + null`；
3. 官方/供应商文件填写 `VENDOR_DOCUMENT` 并附来源；
4. 铭牌、图片和界面填写 `OBSERVED` 并附原始文件；
5. 仪器结果填写 `MEASURED`，同时记录仪器、方法和原始数据；
6. 每件板分别填写五元组、非空且唯一的 serial、lot、照片/日志文件大小与SHA-256；两块板 identity 任一项不同，建立两个 candidate，不合并为同版；
7. 所有强制测试通过、blocker清空后再改变 disposition。

板级 Rust 接入还必须附：最终 C compiler/linker 版本、`yimi-platform-ffi v1`
layout/link probe、`acquire/release` 临界区实现、ISR queue memory ordering、OID/audio
sequence 与 dropped stats、audio timestamp class、storage sync 掉电记录、transport
partial-stream trace、真实 manifest parser 与 DeviceLink transaction transcript HIL，
以及同一输入下 C/Rust 两条路径的 `TestResult v1`。

模板中的型号文字只是采购目标，不是已确认实物事实。`BOARD_TARGET` 只能来自完整 board-kit intake 和 `board-evidence-matrix.csv` 的一致结论。
