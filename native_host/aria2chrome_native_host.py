#!/usr/bin/env python3
"""
Chrome Native Messaging host: reveal a file in the file manager, or rename in place (same folder).

Messages:
  {"path": "/absolute/path/to/file"}  → reveal in Finder / Explorer / xdg-open parent
  {"renameInPlace": {"from": "/abs/old.mp3", "to": "/abs/new.mp3"}}  → os.rename, same directory only

Reply: {"ok": true} or {"ok": false, "error": "reason"}

No network, no telemetry, stdlib only.
"""
from __future__ import annotations

import json
import os
import platform
import struct
import subprocess
import sys
from typing import Any, Dict, Optional

STRUCT_FMT = struct.Struct("<I")
MAX_MSG = 1024 * 64


def read_message() -> Optional[Dict[str, Any]]:
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) != 4:
        return None
    (length,) = STRUCT_FMT.unpack(raw_len)
    if length > MAX_MSG:
        return {"_bad": "message too large"}
    data = sys.stdin.buffer.read(length)
    if len(data) != length:
        return None
    try:
        return json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        return {"_bad": f"invalid json: {e}"}


def write_message(obj: Dict[str, Any]) -> None:
    payload = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(STRUCT_FMT.pack(len(payload)))
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def reveal(path: str) -> Dict[str, Any]:
    if not isinstance(path, str) or not path.strip():
        return {"ok": False, "error": "missing path"}
    path = path.strip()
    if not os.path.isabs(path):
        return {"ok": False, "error": "path must be absolute"}
    if not os.path.exists(path):
        return {"ok": False, "error": "path does not exist"}

    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.run(["/usr/bin/open", "-R", path], check=False, capture_output=True)
        elif system == "Windows":
            subprocess.run(
                ["explorer", "/select," + os.path.normpath(path)],
                check=False,
                capture_output=True,
            )
        else:
            subprocess.run(
                ["xdg-open", os.path.dirname(path)],
                check=False,
                capture_output=True,
            )
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def rename_in_place(from_path: str, to_path: str) -> Dict[str, Any]:
    if not isinstance(from_path, str) or not isinstance(to_path, str):
        return {"ok": False, "error": "missing path"}
    from_path = from_path.strip()
    to_path = to_path.strip()
    if not from_path or not to_path:
        return {"ok": False, "error": "empty path"}
    if "\x00" in from_path or "\x00" in to_path:
        return {"ok": False, "error": "invalid path"}
    if not os.path.isabs(from_path) or not os.path.isabs(to_path):
        return {"ok": False, "error": "paths must be absolute"}
    from_norm = os.path.normpath(from_path)
    to_norm = os.path.normpath(to_path)
    if from_norm == to_norm:
        return {"ok": True}
    from_dir = os.path.dirname(from_norm)
    to_dir = os.path.dirname(to_norm)
    if not from_dir or from_dir != to_dir:
        return {"ok": False, "error": "rename must stay in the same folder"}
    dest_base = os.path.basename(to_norm)
    if not dest_base or dest_base in (".", ".."):
        return {"ok": False, "error": "invalid destination name"}
    if os.sep in dest_base or (os.altsep and dest_base.find(os.altsep) >= 0):
        return {"ok": False, "error": "destination must be a single filename"}
    if not os.path.isfile(from_norm):
        return {"ok": False, "error": "source file does not exist"}
    if os.path.lexists(to_norm):
        return {"ok": False, "error": "destination already exists"}
    try:
        os.rename(from_norm, to_norm)
        return {"ok": True}
    except OSError as e:
        return {"ok": False, "error": str(e)}


def main() -> None:
    while True:
        msg = read_message()
        if msg is None:
            break
        if isinstance(msg, dict) and "_bad" in msg:
            write_message({"ok": False, "error": msg["_bad"]})
            continue
        if not isinstance(msg, dict):
            write_message({"ok": False, "error": "expected JSON object"})
            continue

        rip = msg.get("renameInPlace")
        if isinstance(rip, dict) and "from" in rip and "to" in rip:
            write_message(rename_in_place(rip["from"], rip["to"]))
            continue
        if "path" in msg:
            write_message(reveal(msg["path"]))
            continue
        write_message(
            {
                "ok": False,
                "error": 'expected {"path": "..."} or {"renameInPlace": {"from":"...","to":"..."}}',
            }
        )


if __name__ == "__main__":
    main()
