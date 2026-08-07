# EVT-0 hardware tests

This directory owns host-side acceptance tests for the physical Gen1 EVT-0 pen.
It is intentionally independent from the application workspaces.

## Bootstrap

```powershell
cd D:\work\yimi-pen\hardware\tests
uv sync --frozen
uv run pytest
```

The first smoke test uses pySerial's in-memory `loop://` transport, so it does
not require a board. Real-device fixtures are added only after
`BOARD_TARGET + OID_TARGET_HEAD` and their logging/port contract are locked.

## Future real-device boundary

- Put raw UART/log/audio captures under ignored `artifacts/`.
- Select devices by recorded USB VID/PID/serial number, not by assuming `COM3`.
- Do not toggle RTS/DTR until the board's reset/boot wiring is documented.
- Every result must record board MPN/PCB revision, head revision, firmware,
  code-tool version and print batch.

