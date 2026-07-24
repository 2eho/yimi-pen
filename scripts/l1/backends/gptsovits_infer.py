#!/usr/bin/env python3
"""GPT-SoVITS L1 backend stub — usually runs as external WebUI/API.

Exit: 0 ok, 2 missing, 3 runtime, 4 bad args
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def probe() -> dict:
    api = os.environ.get("YIMI_GPTSOVITS_API", "http://127.0.0.1:9880")
    info = {
        "backend": "gpt-sovits",
        "importable": False,
        "api": api,
        "detail": "expects external GPT-SoVITS API (not pip-import by default)",
    }
    try:
        req = urllib.request.Request(api, method="GET")
        with urllib.request.urlopen(req, timeout=1.5) as resp:  # noqa: S310
            info["importable"] = True
            info["detail"] = f"HTTP {resp.status}"
    except Exception as e:  # noqa: BLE001
        info["detail"] = f"{type(e).__name__}: {e}"
    return info


def synthesize(text: str, ref: Path, out: Path) -> None:
    api = os.environ.get("YIMI_GPTSOVITS_API", "http://127.0.0.1:9880")
    # API shapes differ by fork; document and fail until user configures.
    raise RuntimeError(
        f"Configure GPT-SoVITS HTTP API at {api} and implement request body "
        f"for your fork. ref={ref} text_len={len(text)} out={out}"
    )


def main() -> int:
    p = argparse.ArgumentParser(description="Yimi L1 GPT-SoVITS backend")
    p.add_argument("--probe", action="store_true")
    p.add_argument("--text", default="")
    p.add_argument("--ref", default="")
    p.add_argument("--out", default="")
    args = p.parse_args()

    if args.probe:
        print(json.dumps(probe(), ensure_ascii=False, indent=2))
        r = probe()
        return 0 if r.get("importable") else 2

    if not args.text or not args.ref or not args.out:
        print("need --text --ref --out", file=sys.stderr)
        return 4
    try:
        synthesize(args.text, Path(args.ref), Path(args.out))
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"runtime: {e}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
