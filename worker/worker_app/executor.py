import asyncio
import contextlib
import os
import resource
import shutil
import signal
import tempfile
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

_MAX_CPU_SECONDS = 20
_MAX_OPEN_FILES = 64
_MAX_PROCESSES = 32


@dataclass
class LogLine:
    text: str


@dataclass
class RenderSuccess:
    pdf_bytes: bytes


@dataclass
class RenderFailure:
    message: str


RenderEvent = LogLine | RenderSuccess | RenderFailure


def _limit_subprocess_resources() -> None:
    """Runs inside the child process (via preexec_fn) before exec.

    Memory is intentionally NOT limited here via RLIMIT_AS: it caps virtual
    address space, and Rust-based binaries (typst is Rust) often reserve
    large virtual ranges even with low physical usage, causing spurious
    failures. Memory is bounded at the container level (docker mem_limit)
    instead.
    """
    resource.setrlimit(resource.RLIMIT_CPU, (_MAX_CPU_SECONDS, _MAX_CPU_SECONDS))
    resource.setrlimit(resource.RLIMIT_NOFILE, (_MAX_OPEN_FILES, _MAX_OPEN_FILES))
    resource.setrlimit(resource.RLIMIT_NPROC, (_MAX_PROCESSES, _MAX_PROCESSES))
    os.setsid()


async def _read_lines_with_timeout(
    stream: asyncio.StreamReader, timeout_seconds: float
) -> AsyncIterator[bytes]:
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout_seconds
    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            raise TimeoutError
        line = await asyncio.wait_for(stream.readline(), timeout=remaining)
        if not line:
            return
        yield line


async def run_render(
    yaml_content: str,
    image: tuple[str, bytes] | None,
    timeout_seconds: float = 30.0,
) -> AsyncIterator[RenderEvent]:
    tmpdir = Path(tempfile.mkdtemp(prefix="rendercv-"))
    try:
        yaml_path = tmpdir / "input_CV.yaml"
        yaml_path.write_text(yaml_content, encoding="utf-8")

        if image is not None:
            image_filename, image_bytes = image
            (tmpdir / image_filename).write_bytes(image_bytes)

        pdf_path = tmpdir / "output.pdf"
        process = await asyncio.create_subprocess_exec(
            "rendercv",
            "render",
            str(yaml_path),
            "--pdf-path",
            str(pdf_path),
            "--dont-generate-png",
            "--dont-generate-markdown",
            cwd=str(tmpdir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            preexec_fn=_limit_subprocess_resources,
        )

        assert process.stdout is not None
        try:
            async for raw_line in _read_lines_with_timeout(process.stdout, timeout_seconds):
                yield LogLine(text=raw_line.decode("utf-8", errors="replace").rstrip("\n"))
        except TimeoutError:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            await process.wait()
            yield RenderFailure(message=f"Render timed out after {timeout_seconds} seconds")
            return

        return_code = await process.wait()
        if return_code == 0 and pdf_path.exists():
            yield RenderSuccess(pdf_bytes=pdf_path.read_bytes())
        else:
            yield RenderFailure(message=f"rendercv exited with code {return_code}")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
