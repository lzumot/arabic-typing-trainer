"""Cross-platform launcher: start the trainer server if it is not running,
then open the app in the default browser. Stdlib only, works on Windows,
macOS and Linux.

    python trainer.py
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
PORT = int(os.environ.get("TRAINER_PORT", "8765"))
URL = "http://127.0.0.1:%d/" % PORT

DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200


def healthy():
    try:
        with urllib.request.urlopen(URL + "api/health", timeout=1) as res:
            return bool(json.loads(res.read().decode("utf-8")).get("ok"))
    except Exception:  # noqa: BLE001 - any failure means "not running"
        return False


def start_server():
    os.makedirs(DATA, exist_ok=True)
    log_path = os.path.join(DATA, "server.log")
    log = open(log_path, "a", encoding="utf-8")
    flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    subprocess.Popen(
        [sys.executable, os.path.join(ROOT, "server.py")],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=log,
        creationflags=flags,
        close_fds=True,
    )
    for _ in range(80):
        if healthy():
            return True
        time.sleep(0.25)
    return healthy()


def main():
    if healthy() or start_server():
        webbrowser.open(URL)
        print("Trainer is running at %s" % URL)
        return 0
    print("The trainer could not start. See data/server.log")
    return 1


if __name__ == "__main__":
    code = main()
    if code and os.name == "nt":
        input("Press Enter to close.")
    sys.exit(code)
