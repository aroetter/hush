"""Exercise the built executable in a real PTY with an isolated fake Codex on PATH."""
from __future__ import annotations

import fcntl
import os
from pathlib import Path
import pty
import select
import shlex
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
assert NODE


class Terminal:
    """Own one PTY process and collect output between user interactions."""

    def __init__(self, directory: Path, arguments: list[str], env: dict[str, str]) -> None:
        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 100, 0, 0))
        self.process = subprocess.Popen(
            [NODE, str(ROOT / "dist/cli.js"), *arguments],
            cwd=directory, env=env, stdin=slave, stdout=slave, stderr=slave,
            start_new_session=True,
        )
        os.close(slave)
        self.output = b""

    def wait(self, expected: str, timeout: float = 5) -> bytes:
        """Wait for a visible string; include captured output in failures."""
        start = len(self.output)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if select.select([self.master], [], [], 0.05)[0]:
                try:
                    data = os.read(self.master, 65536)
                except OSError:
                    break
                self.output += data
            if expected.encode() in self.output[start:]:
                return self.output[start:]
        raise AssertionError(f"Missing {expected!r}: {self.output[-8000:]!r}")

    def send(self, text: str) -> None:
        os.write(self.master, text.encode())
        time.sleep(0.12)

    def close(self) -> None:
        if self.process.poll() is None:
            self.send("\x04")
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait()
        os.close(self.master)


with tempfile.TemporaryDirectory(prefix="hush-terminal-") as temp:
    directory = Path(temp)
    binary = directory / "bin"
    binary.mkdir()
    shim = binary / "codex"
    shim.write_text(
        "#!/bin/sh\nexec " + shlex.quote(NODE) + " "
        + shlex.quote(str(ROOT / "test/fixtures/server.mjs")) + ' ui "$@"\n'
    )
    shim.chmod(0o755)
    env = {**os.environ, "PATH": str(binary) + os.pathsep + os.environ["PATH"], "TERM": "xterm-256color"}
    env.pop("CI", None)
    terminal = Terminal(directory, [], env)
    try:
        terminal.wait("Send a message")
        assert b"\x1b[?1049h" in terminal.output, "Missing alternate screen"
        terminal.send("hello")
        terminal.send("\r")
        terminal.wait("Visible test answer")
        assert b"hidden-command-for-test" not in terminal.output
        terminal.send("\x0f")
        terminal.wait("hidden-command-for-test")
        terminal.send("\x0f")
        terminal.send("wait")
        terminal.send("\r")
        terminal.wait("Working: Inspecting files")
        terminal.send("\x03")
        terminal.wait("interrupted")
        fcntl.ioctl(terminal.master, termios.TIOCSWINSZ, struct.pack("HHHH", 18, 50, 0, 0))
        os.kill(terminal.process.pid, signal.SIGWINCH)
        terminal.send("\x04")
        terminal.wait("Resume: hush resume root")
        terminal.process.wait(timeout=5)
        assert terminal.process.returncode == 0
        assert b"\x1b[?1049l" in terminal.output, "Terminal not restored"
    finally:
        terminal.close()
    for command in ["exit", "/exit"]:
        terminal = Terminal(directory, [], env)
        try:
            terminal.wait("Send a message")
            terminal.send(command)
            terminal.send("\r")
            terminal.wait("Resume: hush resume root")
            terminal.process.wait(timeout=5)
            assert terminal.process.returncode == 0
            assert b"\x1b[?1049l" in terminal.output, "Terminal not restored after typed exit"
            assert b"Visible test answer" not in terminal.output, "Exit was sent to the model"
        finally:
            terminal.close()
    for arguments in [["resume"], ["resume", "--last"], ["resume", "root"]]:
        terminal = Terminal(directory, arguments, env)
        try:
            if arguments == ["resume"]:
                terminal.wait("Saved smoke conversation")
                terminal.send("\r")
            terminal.wait("Previous saved answer")
        finally:
            terminal.close()
    terminal = Terminal(directory, [], env)
    try:
        terminal.wait("Send a message")
        terminal.send("approval")
        terminal.send("\r")
        terminal.wait("Command approval")
        terminal.send("2")
        terminal.send("\r")
        terminal.wait("Approval received")
    finally:
        terminal.close()
print("PTY checks passed: conversation, details, interruption, resize, typed exit, terminal restoration, resume picker/last/ID, and approval.")
