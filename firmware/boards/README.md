# Board ports

This directory stays empty until `BOARD_TARGET`, `BOARD_MPN`, and `PCB_REV`
pass the evidence gate. A board port owns the chip HAL or RTOS bindings,
linker/flash configuration, startup code, and the only permitted FFI/`unsafe`
boundary. The product crates under `firmware/crates/` remain target-neutral.

