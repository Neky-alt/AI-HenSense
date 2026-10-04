"""Cross-platform non-blocking exclusive file lock (fcntl on POSIX, msvcrt on Windows).

The BE-04 Worker uses it to guarantee one sync worker per SQLite database. The
previous fcntl-only version made the Worker CLI fail to start on Windows.
"""
from __future__ import annotations

import os
from typing import IO

if os.name == "nt":
    import msvcrt

    def try_lock(handle: IO) -> bool:
        try:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            return True
        except OSError:
            return False

else:
    import fcntl

    def try_lock(handle: IO) -> bool:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:  # BlockingIOError is a subclass
            return False
