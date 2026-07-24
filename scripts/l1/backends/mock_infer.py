#!/usr/bin/env python3
"""Mock L1 backend — pipeline only, NOT real voice clone.

Proves: ref exists + text → out wav. Uses Windows SAPI speech or a beep.

Exit: 0 ok, 3 runtime, 4 args
"""
from __future__ import annotations

import argparse
import json
import math
import struct
import subprocess
import sys
import wave
from pathlib import Path


def probe() -> dict:
    return {
        "backend": "mock",
        "importable": True,
        "detail": "always available - pipeline test only, NOT voice clone",
    }


def write_beep_wav(out: Path, seconds: float = 1.0, freq: float = 523.25) -> None:
    rate = 22050
    n = int(rate * seconds)
    out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for i in range(n):
            val = int(6000 * math.sin(2 * math.pi * freq * (i / rate)))
            frames += struct.pack("<h", val)
        w.writeframes(frames)


def synthesize_sapi(text: str, wav: Path) -> bool:
    wav.parent.mkdir(parents=True, exist_ok=True)
    ps = f"""
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {{
  $voices = $s.GetInstalledVoices() | ForEach-Object {{ $_.VoiceInfo }}
  $zh = $voices | Where-Object {{ $_.Culture.Name -like 'zh*' }} | Select-Object -First 1
  if ($zh) {{ $s.SelectVoice($zh.Name) }}
}} catch {{}}
$s.Rate = 0
$s.Volume = 100
$s.SetOutputToWaveFile({json.dumps(str(wav))})
$s.Speak({json.dumps(text)})
$s.Dispose()
"""
    r = subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps],
        capture_output=True,
        text=True,
    )
    return r.returncode == 0 and wav.is_file() and wav.stat().st_size > 44


def synthesize(text: str, ref: Path, out: Path) -> Path:
    if not ref.is_file():
        raise FileNotFoundError(f"ref missing: {ref}")
    out = Path(out)
    # normalize to .wav for mock
    wav = out if out.suffix.lower() == ".wav" else out.with_suffix(".wav")
    ok = synthesize_sapi(text, wav)
    if not ok:
        write_beep_wav(wav)
    meta = Path(str(wav) + ".l1-mock.json")
    meta.write_text(
        json.dumps(
            {
                "backend": "mock",
                "clone": False,
                "ref": str(ref.resolve()),
                "text": text,
                "sapi": ok,
                "note": "Not a real voice clone. Yimi L1 pipeline validation only.",
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return wav


def main() -> int:
    p = argparse.ArgumentParser(description="Yimi L1 mock backend")
    p.add_argument("--probe", action="store_true")
    p.add_argument("--text", default="")
    p.add_argument("--ref", default="")
    p.add_argument("--out", default="")
    args = p.parse_args()

    if args.probe:
        print(json.dumps(probe(), ensure_ascii=False, indent=2))
        return 0

    if not args.text or not args.ref or not args.out:
        print("need --text --ref --out", file=sys.stderr)
        return 4
    try:
        path = synthesize(args.text, Path(args.ref), Path(args.out))
        print(str(path))
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"runtime: {e}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
