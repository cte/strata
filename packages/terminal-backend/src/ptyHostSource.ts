export const PTY_HOST_SOURCE = String.raw`
import base64
import fcntl
import json
import os
import pty
import selectors
import signal
import struct
import sys
import termios
import time


def positive_int(value, fallback):
    try:
        parsed = int(value)
    except Exception:
        return fallback
    return parsed if parsed > 0 else fallback


shell = os.environ.get("STRATA_TERMINAL_SHELL") or os.environ.get("SHELL") or "/bin/sh"
cols = positive_int(os.environ.get("STRATA_TERMINAL_COLS"), 80)
rows = positive_int(os.environ.get("STRATA_TERMINAL_ROWS"), 24)

pid, master_fd = pty.fork()

if pid == 0:
    os.environ["TERM"] = os.environ.get("TERM") or "xterm-256color"
    os.environ["COLORTERM"] = os.environ.get("COLORTERM") or "truecolor"
    os.environ["STRATA_WEB_TERMINAL"] = "1"
    os.environ["COLUMNS"] = str(cols)
    os.environ["LINES"] = str(rows)
    os.execlp(shell, shell, "-i")


def set_winsize(next_cols, next_rows):
    packed = struct.pack("HHHH", next_rows, next_cols, 0, 0)
    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, packed)
    try:
        os.kill(pid, signal.SIGWINCH)
    except ProcessLookupError:
        pass


def terminate_child(sig=signal.SIGTERM):
    try:
        os.kill(pid, sig)
    except ProcessLookupError:
        pass


def signal_handler(signum, _frame):
    terminate_child(signal.SIGTERM)
    deadline = time.time() + 0.5
    while time.time() < deadline:
        finished = reap_child(False)
        if finished is not None:
            raise SystemExit(finished)
        time.sleep(0.02)
    terminate_child(signal.SIGKILL)
    raise SystemExit(128 + signum)


def reap_child(block):
    flags = 0 if block else os.WNOHANG
    try:
        finished_pid, status = os.waitpid(pid, flags)
    except ChildProcessError:
        return 0
    if finished_pid == 0:
        return None
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 0


signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)
set_winsize(cols, rows)

selector = selectors.DefaultSelector()
selector.register(master_fd, selectors.EVENT_READ, "pty")
selector.register(sys.stdin.buffer, selectors.EVENT_READ, "control")
control_buffer = b""
stdin_open = True
exit_code = 0

try:
    while True:
        finished = reap_child(False)
        if finished is not None:
            exit_code = finished
            break

        for key, _mask in selector.select(timeout=0.05):
            if key.data == "pty":
                try:
                    data = os.read(master_fd, 4096)
                except OSError:
                    data = b""
                if not data:
                    finished = reap_child(False)
                    exit_code = finished if finished is not None else 0
                    raise SystemExit(exit_code)
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
                continue

            if key.data == "control" and stdin_open:
                chunk = sys.stdin.buffer.read1(4096)
                if not chunk:
                    stdin_open = False
                    selector.unregister(sys.stdin.buffer)
                    continue
                control_buffer += chunk
                while b"\n" in control_buffer:
                    raw_line, control_buffer = control_buffer.split(b"\n", 1)
                    if not raw_line:
                        continue
                    try:
                        message = json.loads(raw_line.decode("utf-8"))
                    except Exception as error:
                        print("invalid control frame: " + str(error), file=sys.stderr, flush=True)
                        continue

                    kind = message.get("type")
                    if kind == "input":
                        payload = base64.b64decode(message.get("dataBase64", ""))
                        if payload:
                            os.write(master_fd, payload)
                    elif kind == "resize":
                        next_cols = positive_int(message.get("cols"), cols)
                        next_rows = positive_int(message.get("rows"), rows)
                        set_winsize(next_cols, next_rows)
                    elif kind == "close":
                        terminate_child(signal.SIGTERM)
                    else:
                        print("unknown control frame: " + str(kind), file=sys.stderr, flush=True)
finally:
    try:
        selector.close()
    except Exception:
        pass
    try:
        os.close(master_fd)
    except Exception:
        pass

raise SystemExit(exit_code)
`;
