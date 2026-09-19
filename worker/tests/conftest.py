import os
import sys
from pathlib import Path

# The worker's tests exercise real `rendercv` subprocess calls, so the directory
# holding the currently running interpreter (the virtualenv's bin/ when tests
# run under it, wherever that venv lives) must be on PATH for the executable to
# resolve. Scoped to worker/tests/ because no other suite spawns subprocesses.
_interpreter_bin = Path(sys.executable).parent
if _interpreter_bin.is_dir():
    os.environ["PATH"] = f"{_interpreter_bin}{os.pathsep}" + os.environ.get("PATH", "")
