"""HTTP client used by the Raspberry Pi worker."""

from __future__ import annotations

import json
from pathlib import Path

import requests

from config import PiWorkerConfig


class BackendClientError(RuntimeError):
    """Raised when communication with the Backend fails.

    ``status_code`` is the HTTP status when the Backend answered, or None when the
    request never got a response (network error, timeout).
    """

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code

    @property
    def retryable(self) -> bool:
        return self.status_code is None or self.status_code >= 500


class BackendClient:
    def __init__(
        self,
        config: PiWorkerConfig,
    ) -> None:
        self.config = config

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "X-Hardware-Key": self.config.hardware_api_key,
        }

    def _url(
        self,
        path: str,
    ) -> str:
        return (
            self.config.backend_base_url.rstrip("/")
            + "/api/v1"
            + path
        )

    def _read_response(
        self,
        response: requests.Response,
    ) -> dict:
        try:
            payload = response.json()
        except ValueError as exc:
            raise BackendClientError(
                "Backend returned a non-JSON response "
                f"(HTTP {response.status_code})",
                response.status_code,
            ) from exc

        if not response.ok:
            detail = payload.get("detail")

            if detail is None:
                detail = payload

            raise BackendClientError(
                f"Backend request failed "
                f"(HTTP {response.status_code}): {detail}",
                response.status_code,
            )

        if not isinstance(payload, dict):
            raise BackendClientError(
                "Backend response must be a JSON object"
            )

        return payload

    def heartbeat(
        self,
    ) -> dict:
        """Send one device heartbeat."""

        try:
            response = requests.post(
                self._url(
                    f"/hardware/devices/"
                    f"{self.config.device_id}/heartbeat"
                ),
                headers=self._headers,
                timeout=self.config.request_timeout_seconds,
            )
        except requests.RequestException as exc:
            raise BackendClientError(
                f"Heartbeat request failed: {exc}"
            ) from exc

        return self._read_response(response)

    def get_monitoring_config(
        self,
    ) -> dict:
        """Read the monitoring configuration for this device."""

        try:
            response = requests.get(
                self._url(
                    f"/hardware/devices/"
                    f"{self.config.device_id}/monitoring-config"
                ),
                headers=self._headers,
                timeout=self.config.request_timeout_seconds,
            )
        except requests.RequestException as exc:
            raise BackendClientError(
                f"Monitoring config request failed: {exc}"
            ) from exc

        return self._read_response(response)

    def get_monitoring_due(
        self,
    ) -> dict:
        """Ask whether one automatic monitoring sample is due."""

        try:
            response = requests.get(
                self._url(
                    f"/hardware/devices/"
                    f"{self.config.device_id}/monitoring-due"
                ),
                headers=self._headers,
                timeout=self.config.request_timeout_seconds,
            )
        except requests.RequestException as exc:
            raise BackendClientError(
                f"Monitoring due request failed: {exc}"
            ) from exc

        return self._read_response(response)

    def claim_command(
        self,
    ) -> dict:
        """Claim the next pending hardware command."""

        try:
            response = requests.post(
                self._url(
                    f"/hardware/devices/"
                    f"{self.config.device_id}/commands/claim"
                ),
                headers=self._headers,
                timeout=self.config.request_timeout_seconds,
            )
        except requests.RequestException as exc:
            raise BackendClientError(
                f"Command claim request failed: {exc}"
            ) from exc

        return self._read_response(response)

    def submit_detection_result(
        self,
        command_id: str,
        image_path: str | Path,
        result: dict,
    ) -> dict:
        """Upload one locally inferred manual detection."""

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

        try:
            with path.open("rb") as image_file:
                response = requests.post(
                    self._url(
                        f"/hardware/devices/"
                        f"{self.config.device_id}/commands/"
                        f"{command_id}/detection"
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
                        ),
                    },
                    timeout=self.config.request_timeout_seconds,
                )
        except requests.RequestException as exc:
            raise BackendClientError(
                f"Detection upload failed: {exc}"
            ) from exc
        except OSError as exc:
            raise BackendClientError(
                f"Could not read detection image: {exc}"
            ) from exc

        return self._read_response(response)

    def submit_monitoring_sample(
        self,
        image_path: str | Path,
        result: dict,
    ) -> dict:
        """Upload one locally inferred automatic monitoring sample."""

        path = Path(image_path)

        if not path.is_file():
            raise BackendClientError(
                f"Monitoring image does not exist: {path}"
            )

        suffix = path.suffix.lower()

        if suffix in {".jpg", ".jpeg"}:
            content_type = "image/jpeg"
        elif suffix == ".png":
            content_type = "image/png"
        else:
            raise BackendClientError(
                "Monitoring image must be JPEG or PNG"
            )

        try:
            result_json = json.dumps(result)
        except (TypeError, ValueError) as exc:
            raise BackendClientError(
                "Monitoring result is not JSON serializable"
            ) from exc

        try:
            with path.open("rb") as image_file:
                response = requests.post(
                    self._url(
                        f"/hardware/devices/"
                        f"{self.config.device_id}/monitoring-samples"
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
                        ),
                    },
                    timeout=self.config.request_timeout_seconds,
                )
        except requests.RequestException as exc:
            raise BackendClientError(
                f"Monitoring sample upload failed: {exc}"
            ) from exc
        except OSError as exc:
            raise BackendClientError(
                f"Could not read monitoring image: {exc}"
            ) from exc

        return self._read_response(response)

    def complete_command(
        self,
        command_id: str,
        result_detection_id: str | None = None,
    ) -> dict:
        """Mark one running command as completed."""

        try:
            response = requests.post(
                self._url(
                    f"/hardware/devices/"
                    f"{self.config.device_id}/commands/"
                    f"{command_id}/complete"
                ),
                headers=self._headers,
                json={
                    "result_detection_id": result_detection_id,
                },
                timeout=self.config.request_timeout_seconds,
            )
        except requests.RequestException as exc:
            raise BackendClientError(
                f"Command completion request failed: {exc}"
            ) from exc

        return self._read_response(response)

    def fail_command(
        self,
        command_id: str,
        error_message: str,
    ) -> dict:
        """Mark one running command as failed."""

        try:
            response = requests.post(
                self._url(
                    f"/hardware/devices/"
                    f"{self.config.device_id}/commands/"
                    f"{command_id}/fail"
                ),
                headers=self._headers,
                json={
                    "error_message": error_message,
                },
                timeout=self.config.request_timeout_seconds,
            )
        except requests.RequestException as exc:
            raise BackendClientError(
                f"Command failure request failed: {exc}"
            ) from exc

        return self._read_response(response)