import os
from pathlib import Path

# Add the virtual environment's bin directory to PATH so that subprocess calls can find executables
venv_bin = Path(__file__).parent / ".venv" / "bin"
if venv_bin.exists():
    os.environ["PATH"] = str(venv_bin) + ":" + os.environ.get("PATH", "")
