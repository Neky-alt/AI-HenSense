"""Reset process-wide state between tests."""
import pytest

from app.services import detection_deletion
from app.services.monitoring_lease import monitoring_leases


@pytest.fixture(autouse=True)
def _reset_process_state():
    monitoring_leases.reset()
    detection_deletion.reset_retention_throttle()
    yield
    monitoring_leases.reset()
    detection_deletion.reset_retention_throttle()
