#!/usr/bin/env python3
"""
Chrome Native Messaging host: reveal a file in the OS file manager (Finder / Explorer / etc.).

Protocol: length-prefixed JSON (Chrome native messaging).
Message in:  { "path": "/absolute/path/to/file" }
Message out: { "ok": true } or { "ok": false, "error": "..." }
"""
import json
import os
import platform
import shutil
import struct
import subprocess
import sys
from typing import Any, Dict, Optional


def _read_message() -> Optional[Dict[str, Any]]:
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) != 4:
        return None
    (length,) = struct.unpack("=I", raw_len)
    if length > 1024 * 1024:
        return None
    data = sys.stdin.buffer.read(length)
    if len(data) != length:
        return None
    return json.loads(data.decode("utf-8"))


def _send_message(obj: dict) -> None:
    encoded = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def _normalize_path(p: str) -> str:
    p = (p or "").strip()
    if p.startswith("file://"):
        from urllib.parse import unquote, urlparse

        u = urlparse(p)
        path = unquote(u.path)
        if platform.system() == "Windows" and path.startswith("/"):
            path = path[1:]
        return path
    return p


def _reveal(path: str) -> None:
    path = os.path.abspath(_normalize_path(path))
    if not os.path.exists(path):
        raise FileNotFoundError(path)

    system = platform.system()
    if system == "Darwin":
        subprocess.run(["open", "-R", path], check=False)
        return
    if system == "Windows":
        # explorer /select,"C:\path with spaces\file"
        p = os.path.normpath(path)
        subprocess.run(f'explorer /select,"{p}"', shell=True, check=False)
        return

    # Linux / BSD: try file managers that support selecting a file
    parent = os.path.dirname(path)
    for cmd in (
        ["nautilus", "--select", path],
        ["dolphin", "--select", path],
        ["nemo", path],
        ["thunar", path],
    ):
        exe = cmd[0]
        if shutil.which(exe):
            subprocess.run(cmd, check=False)
            return
    subprocess.run(["xdg-open", parent], check=False)


def main() -> None:
    msg = _read_message()
    if msg is None:
        sys.exit(0)
    try:
        raw = msg.get("path", "")
        if not raw:
            _send_message({"ok": False, "error": "missing path"})
            return
        _reveal(raw)
        _send_message({"ok": True})
    except Exception as e:
        _send_message({"ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
