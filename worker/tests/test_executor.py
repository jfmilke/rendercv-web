import asyncio
import base64
import tempfile
from pathlib import Path

import pytest

from worker_app.executor import LogLine, RenderFailure, RenderSuccess, run_render

FIXTURES = Path(__file__).parent / "fixtures"

_TINY_PNG_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY"
    "42YAAAAASUVORK5CYII="
)


@pytest.mark.asyncio
async def test_run_render_success_with_valid_yaml():
    yaml_content = (FIXTURES / "minimal_valid.yaml").read_text()

    events = [event async for event in run_render(yaml_content, image=None, timeout_seconds=30)]

    log_lines = [e for e in events if isinstance(e, LogLine)]
    terminal = events[-1]
    assert len(log_lines) >= 1
    assert isinstance(terminal, RenderSuccess)
    assert terminal.pdf_bytes.startswith(b"%PDF")


@pytest.mark.asyncio
async def test_run_render_failure_with_invalid_yaml():
    yaml_content = (FIXTURES / "minimal_invalid.yaml").read_text()

    events = [event async for event in run_render(yaml_content, image=None, timeout_seconds=30)]

    terminal = events[-1]
    assert isinstance(terminal, RenderFailure)


@pytest.mark.asyncio
async def test_run_render_places_image_next_to_yaml_and_succeeds():
    yaml_content = (
        "cv:\n"
        "  name: Bob Smith\n"
        "  photo: avatar.png\n"
        "  sections:\n"
        "    experience:\n"
        "    - company: Acme Corp\n"
        "      position: Software Engineer\n"
        "      start_date: 2022-01\n"
        "      end_date: present\n"
        "design:\n"
        "  theme: classic\n"
        "locale:\n"
        "  language: english\n"
    )
    png_bytes = base64.b64decode(_TINY_PNG_BASE64)

    events = [
        event
        async for event in run_render(
            yaml_content, image=("avatar.png", png_bytes), timeout_seconds=30
        )
    ]

    terminal = events[-1]
    log_text = "\n".join(e.text for e in events if isinstance(e, LogLine))
    assert isinstance(terminal, RenderSuccess), log_text


@pytest.mark.asyncio
async def test_run_render_cleans_up_temp_directory(monkeypatch):
    yaml_content = (FIXTURES / "minimal_valid.yaml").read_text()
    created_dirs: list[Path] = []
    original_mkdtemp = tempfile.mkdtemp

    def tracking_mkdtemp(*args, **kwargs):
        path = original_mkdtemp(*args, **kwargs)
        created_dirs.append(Path(path))
        return path

    monkeypatch.setattr("worker_app.executor.tempfile.mkdtemp", tracking_mkdtemp)

    async for _ in run_render(yaml_content, image=None, timeout_seconds=30):
        pass

    assert len(created_dirs) == 1
    assert not created_dirs[0].exists()


@pytest.mark.asyncio
async def test_run_render_times_out_and_kills_process_group(monkeypatch):
    yaml_content = (FIXTURES / "minimal_valid.yaml").read_text()

    class HangingProcess:
        pid = 999999
        stdout = asyncio.StreamReader()

        async def wait(self):
            return 0

    async def fake_create_subprocess_exec(*args, **kwargs):
        return HangingProcess()

    killed = []

    def fake_killpg(pid, sig):
        killed.append((pid, sig))

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    monkeypatch.setattr("worker_app.executor.os.killpg", fake_killpg)

    events = [
        event async for event in run_render(yaml_content, image=None, timeout_seconds=0.05)
    ]

    terminal = events[-1]
    assert isinstance(terminal, RenderFailure)
    assert "timed out" in terminal.message
    assert killed


@pytest.mark.asyncio
async def test_run_render_ignores_image_with_path_traversal_filename(monkeypatch):
    """Fix 11: a filename with path components is ignored, not written."""
    created_dirs: list[Path] = []
    original_mkdtemp = tempfile.mkdtemp

    def tracking_mkdtemp(*args, **kwargs):
        path = original_mkdtemp(*args, **kwargs)
        created_dirs.append(Path(path))
        return path

    monkeypatch.setattr("worker_app.executor.tempfile.mkdtemp", tracking_mkdtemp)

    written: list[Path] = []
    real_write_bytes = Path.write_bytes

    def tracking_write_bytes(self, data):
        written.append(Path(self))
        return real_write_bytes(self, data)

    monkeypatch.setattr(Path, "write_bytes", tracking_write_bytes)

    png_bytes = base64.b64decode(_TINY_PNG_BASE64)
    yaml_content = (FIXTURES / "minimal_valid.yaml").read_text()

    events = [
        event
        async for event in run_render(
            yaml_content, image=("../../escaped.png", png_bytes), timeout_seconds=30
        )
    ]

    # Nothing was written outside (or anywhere via) the image path, and the
    # render itself still completed rather than erroring out.
    assert written == []
    assert isinstance(events[-1], RenderSuccess | RenderFailure)
    tmpdir = created_dirs[0]
    assert not (tmpdir.parent.parent / "escaped.png").exists()


@pytest.mark.asyncio
async def test_run_render_writes_image_with_plain_filename(monkeypatch):
    """Fix 11 control case: an ordinary filename is still written."""
    written: list[Path] = []
    real_write_bytes = Path.write_bytes

    def tracking_write_bytes(self, data):
        written.append(Path(self))
        return real_write_bytes(self, data)

    monkeypatch.setattr(Path, "write_bytes", tracking_write_bytes)

    png_bytes = base64.b64decode(_TINY_PNG_BASE64)
    yaml_content = (FIXTURES / "minimal_valid.yaml").read_text()

    async for _ in run_render(
        yaml_content, image=("avatar.png", png_bytes), timeout_seconds=30
    ):
        pass

    assert [p.name for p in written] == ["avatar.png"]


@pytest.mark.asyncio
async def test_run_render_kills_process_that_closes_stdout_without_exiting(monkeypatch):
    """Fix 10: waiting for exit after EOF is itself bounded."""
    yaml_content = (FIXTURES / "minimal_valid.yaml").read_text()

    stdout = asyncio.StreamReader()
    stdout.feed_data(b"working...\n")
    stdout.feed_eof()

    class StuckProcess:
        pid = 999999

        def __init__(self):
            self.stdout = stdout
            self.wait_calls = 0

        async def wait(self):
            self.wait_calls += 1
            if self.wait_calls == 1:
                await asyncio.sleep(3600)
            return -9

    process = StuckProcess()

    async def fake_create_subprocess_exec(*args, **kwargs):
        return process

    killed = []

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    monkeypatch.setattr("worker_app.executor.os.killpg", lambda pid, sig: killed.append(pid))
    monkeypatch.setattr("worker_app.executor._EXIT_GRACE_SECONDS", 0.05)

    events = [event async for event in run_render(yaml_content, image=None, timeout_seconds=30)]

    terminal = events[-1]
    assert isinstance(terminal, RenderFailure)
    assert "did not exit" in terminal.message
    assert killed == [999999]
