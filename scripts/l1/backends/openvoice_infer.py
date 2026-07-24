#!/usr/bin/env python3
"""OpenVoice L1 backend for Yimi Pen (optional).

Exit codes:
  0  success (wrote --out)
  2  dependency missing
  3  runtime error
  4  bad args
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def probe() -> dict:
    info = {"backend": "openvoice", "importable": False, "detail": ""}
    try:
        import openvoice  # type: ignore  # noqa: F401

        info["importable"] = True
        info["detail"] = getattr(openvoice, "__file__", "imported")
    except Exception as e:  # noqa: BLE001
        info["detail"] = f"{type(e).__name__}: {e}"
    return info


def synthesize(text: str, ref: Path, out: Path) -> None:
    # Real OpenVoice API varies by version; try common patterns then fail clearly.
    try:
        # Pattern A: myshell OpenVoice se_extractor + ToneColorConverter (v1-style)
        from openvoice import se_extractor  # type: ignore
        from openvoice.api import ToneColorConverter  # type: ignore
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(
            "openvoice package found but API layout unexpected. "
            "Install per https://github.com/myshell-ai/OpenVoice and adapt this script. "
            f"import_error={e}"
        ) from e

    raise RuntimeError(
        "OpenVoice is importable but full conversion needs checkpoint paths "
        "(config.json + checkpoint.pth). Set YIMI_OPENVOICE_CKPT and extend "
        "scripts/l1/backends/openvoice_infer.py, or use CosyVoice backend. "
        f"ref={ref} text_len={len(text)} out={out}"
    )


def main() -> int:
    p = argparse.ArgumentParser(description="Yimi L1 OpenVoice backend")
    p.add_argument("--probe", action="store_true")
    p.add_argument("--text", default="")
    p.add_argument("--ref", default="")
    p.add_argument("--out", default="")
    args = p.parse_args()

    if args.probe:
        import json

        print(json.dumps(probe(), ensure_ascii=False, indent=2))
        return 0 if probe()["importable"] else 2

    if not args.text or not args.ref or not args.out:
        print("need --text --ref --out (or --probe)", file=sys.stderr)
        return 4

    ref = Path(args.ref)
    out = Path(args.out)
    if not ref.is_file():
        print(f"ref not found: {ref}", file=sys.stderr)
        return 4

    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        synthesize(args.text, ref, out)
        if not out.is_file():
            print("synthesize returned without creating out file", file=sys.stderr)
            return 3
        print(str(out))
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"runtime: {e}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
