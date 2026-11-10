"""Download and unpack a portable Node.js LTS runtime into .tools/node.

Usage: python scripts/bootstrap_node.py [version]
If no version is given, the newest v24 LTS release is resolved from nodejs.org.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, ".tools")
DEST = os.path.join(TOOLS, "node")


def http_get(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "LiteratureX-bootstrap/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def main() -> int:
    version = sys.argv[1] if len(sys.argv) > 1 else None
    if not version:
        index = json.loads(http_get("https://nodejs.org/dist/index.json"))
        candidates = [x for x in index if x["version"].startswith("v24.") and x.get("lts")]
        if not candidates:
            print("No Node 24 LTS release found", file=sys.stderr)
            return 1
        version = candidates[0]["version"]
    name = f"node-{version}-win-x64"
    zip_name = f"{name}.zip"
    base = f"https://nodejs.org/dist/{version}"
    os.makedirs(TOOLS, exist_ok=True)
    zip_path = os.path.join(TOOLS, zip_name)

    shasums = http_get(f"{base}/SHASUMS256.txt").decode("utf-8")
    expected = None
    for line in shasums.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1] == zip_name:
            expected = parts[0]
            break
    if not expected:
        print(f"Could not find checksum for {zip_name}", file=sys.stderr)
        return 1

    print(f"Downloading {base}/{zip_name} ...")
    data = http_get(f"{base}/{zip_name}", timeout=600)
    digest = hashlib.sha256(data).hexdigest()
    if digest != expected:
        print(f"Checksum mismatch: got {digest}, expected {expected}", file=sys.stderr)
        return 1
    with open(zip_path, "wb") as fh:
        fh.write(data)

    if os.path.isdir(DEST):
        shutil.rmtree(DEST)
    os.makedirs(DEST, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(TOOLS)
    extracted = os.path.join(TOOLS, name)
    if os.path.isdir(extracted):
        if os.path.isdir(DEST):
            shutil.rmtree(DEST)
        os.rename(extracted, DEST)
    os.remove(zip_path)

    node = os.path.join(DEST, "node.exe")
    npm = os.path.join(DEST, "npm.cmd")
    print(f"Node installed: {node}")
    print(f"npm installed:  {npm}")
    print(f"Version: {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
