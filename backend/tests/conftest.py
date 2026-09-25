import os
import sys
from pathlib import Path

# backend's render tests now exercise real `rendercv` subprocess calls (they
# used to be worker-only), so the directory holding the currently running
# interpreter (the virtualenv's bin/ when tests run under it) must be on PATH
# for the executable to resolve.
_interpreter_bin = Path(sys.executable).parent
if _interpreter_bin.is_dir():
    os.environ["PATH"] = f"{_interpreter_bin}{os.pathsep}" + os.environ.get("PATH", "")
