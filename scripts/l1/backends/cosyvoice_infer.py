#!/usr/bin/env python3
"""CosyVoice L1 backend for Yimi Pen (optional).

Exit: 0 ok, 2 missing dep, 3 runtime, 4 bad args
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def probe() -> dict:
    info = {"backend": "cosyvoice", "importable": False, "detail": ""}
    for name in ("cosyvoice", "CosyVoice"):
        try:
            __import__(name)
            info["importable"] = True
            info["detail"] = f"import {name} ok"
            return info
        except Exception as e:  # noqa: BLE001
            info["detail"] = f"{name}: {type(e).__name__}: {e}"
    return info


def synthesize(text: str, ref: Path, out: Path) -> None:
    raise RuntimeError(
        "CosyVoice package layout requires model dir + official inference entry. "
        "Clone https://github.com/FunAudioLLM/CosyVoice and wire model path via "
        "YIMI_COSYVOICE_MODEL. PoC skeleton only. "
        f"ref={ref} text_len={len(text)} out={out}"
    )


def main() -> int:
    p = argparse.ArgumentParser(description="Yimi L1 CosyVoice backend")
    p.add_argument("--probe", action="store_true")
    p.add_argument("--text", default="")
    p.add_argument("--ref", default="")
    p.add_argument("--out", default="")
    args = p.parse_args()

    if args.probe:
        print(json.dumps(probe(), ensure_ascii=False, indent=2))
        return 0 if probe()["importable"] else 2

    if not args.text or not args.ref or not args.out:
        print("need --text --ref --out", file=sys.stderr)
        return 4
    ref = Path(args.ref)
    if not ref.is_file():
        print(f"ref not found: {ref}", file=sys.stderr)
        return 4
    try:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        synthesize(args.text, ref, out)
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"runtime: {e}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
