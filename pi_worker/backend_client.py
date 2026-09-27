"""HTTP client used by the Raspberry Pi worker."""

from __future__ import annotations

import json
from pathlib import Path

import requests

from config import PiWorkerConfig


class BackendClientError(RuntimeError):
    """Raised when the Backend request fails."""


class BackendClient:
    def __init__(self, config: PiWorkerConfig):
        self.config = config

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "X-Hardware-Key": self.config.hardware_api_key,
        }

    def _url(self, path: str) -> str:
        return f"{self.config.backend_base_url}/api/v1{path}"

    def heartbeat(self) -> dict:
        response = requests.post(
            self._url(
                f"/hardware/devices/{self.config.device_id}/heartbeat"
            ),
            headers=self._headers,
            timeout=self.config.request_timeout_seconds,
        )
        return self._read_response(response)

    def get_monitoring_config(self) -> dict:
        response = requests.get(
            self._url(
                f"/hardware/devices/{self.config.device_id}/monitoring-config"
            ),
            headers=self._headers,
            timeout=self.config.request_timeout_seconds,
        )
        return self._read_response(response)

    def claim_command(self) -> dict | None:
        response = requests.post(
            self._url(
                f"/hardware/devices/{self.config.device_id}/commands/claim"
            ),
            headers=self._headers,
            timeout=self.config.request_timeout_seconds,
        )

        payload = self._read_response(response)
        return payload.get("data")

    def submit_detection_result(
        self,
        command_id: str,
        image_path: str | Path,
        result: dict,
    ) -> dict:
        """Upload a locally inferred result and its source image."""

        path = Path(image_path)

        if not path.is_file():
            raise BackendClientError(
                f"Detection image does not exist: {path}"
            )

        suffix = path.suffix.lower()

        if suffix in {".jpg", ".jpeg"}:
            content_type = "image/jpeg"
        elif suffix == ".png":
            content_type = "image/png"
        else:
            raise BackendClientError(
                "Detection image must be JPEG or PNG"
            )

        try:
            result_json = json.dumps(result)
        except (TypeError, ValueError) as exc:
            raise BackendClientError(
                "Detection result is not JSON serializable"
            ) from exc

        with path.open("rb") as image_file:
            response = requests.post(
                self._url(
                    f"/hardware/devices/{self.config.device_id}"
                    f"/commands/{command_id}/detection"
                ),
                headers=self._headers,
                data={
                    "result_json": result_json,
                },
                files={
                    "file": (
                        path.name,
                        image_file,
                        content_type,
                    )
                },
                timeout=self.config.request_timeout_seconds,
            )

        return self._read_response(response)

    def fail_command(
        self,
        command_id: str,
        error_message: str,
    ) -> dict:
        """Mark a running hardware command as failed."""

        response = requests.post(
            self._url(
                f"/hardware/devices/{self.config.device_id}"
                f"/commands/{command_id}/fail"
            ),
            headers=self._headers,
            json={
                "error_message": error_message,
            },
            timeout=self.config.request_timeout_seconds,
        )

        return self._read_response(response)

    @staticmethod
    def _read_response(response: requests.Response) -> dict:
        try:
            payload = response.json()
        except ValueError as exc:
            raise BackendClientError(
                f"Backend returned invalid JSON "
                f"(HTTP {response.status_code})"
            ) from exc

        if not response.ok:
            raise BackendClientError(
                f"Backend request failed "
                f"({response.status_code}): {payload}"
            )

        return payload