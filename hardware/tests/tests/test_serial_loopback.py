import serial


def test_pyserial_loopback() -> None:
    payload = b"YIMI_PHASE_A_SERIAL_SMOKE"

    with serial.serial_for_url("loop://", timeout=0.5) as port:
        assert port.write(payload) == len(payload)
        assert port.read(len(payload)) == payload

