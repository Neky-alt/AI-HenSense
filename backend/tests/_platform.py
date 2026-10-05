"""Platform capability checks shared by tests."""
import os
import tempfile
from pathlib import Path

import pytest


def _symlinks_supported() -> bool:
    # Windows only allows symlinks for admins or with Developer Mode enabled.
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "target"
        target.write_text("x")
        try:
            os.symlink(target, Path(tmp) / "link")
            return True
        except (OSError, NotImplementedError):
            return False


requires_symlinks = pytest.mark.skipif(
    not _symlinks_supported(),
    reason="Creating symlinks is not permitted here (Windows needs Developer Mode or admin rights)",
)
