"""Synchronous Supabase writes for Device Management (Add / Rename / Remove / Purge).

The BE-04 Worker is an upsert-only outbox and never propagates hard deletes, so the
two operations that must be globally consistent go to the cloud *first*:

- Add:   the cloud ``devices`` row is inserted before the local row; the cloud is the
         final arbiter of global ``device_code`` uniqueness.
- Purge: cloud media, alerts, detections, storage settings and the device row are
         deleted before anything local is touched.

Rename and soft delete are best-effort here; the Worker re-uploads the changed row
later anyway (``is_active`` and ``device_name`` are part of its device payload).

Server-side only: uses the service-role key (``SUPABASE_KEY``). Never expose it.
Disabled unless ``DEVICE_CLOUD_WRITE_ENABLED=true``.
"""
from __future__ import annotations

from urllib.parse import quote

import httpx

from app.config import settings

BUCKET = "detection-images"


class CloudUnavailable(Exception):
    """The cloud could not complete the operation; nothing should change locally."""


class CloudCodeTaken(Exception):
    """The cloud already has a device with this device_code."""


class DeviceCloud:
    def __init__(self, url: str, service_key: str, timeout: float = 15):
        if not url.startswith("https://") or not service_key:
            raise CloudUnavailable("Cloud device writes are not configured")
        self.base = url.rstrip("/")
        self.http = httpx.Client(
            timeout=timeout,
            headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
            follow_redirects=False,
        )

    def close(self) -> None:
        self.http.close()

    # ------------------------------------------------------------------ helpers
    def _request(self, method: str, path: str, *, ok_404: bool = False, **kwargs) -> httpx.Response:
        try:
            response = self.http.request(method, f"{self.base}{path}", **kwargs)
        except httpx.HTTPError as exc:
            # Never include request headers / keys in the message.
            raise CloudUnavailable(type(exc).__name__) from None
        if ok_404 and response.status_code == 404:
            return response
        if response.status_code >= 400:
            raise CloudUnavailable(f"Supabase HTTP {response.status_code} at {path.split('?')[0]}")
        return response

    # ------------------------------------------------------------------- reads
    def code_taken(self, device_code: str) -> bool:
        response = self._request(
            "GET",
            "/rest/v1/devices",
            params={"select": "device_id", "device_code": f"eq.{device_code}", "limit": 1},
        )
        return bool(response.json())

    # ------------------------------------------------------------------ writes
    def insert_device(self, payload: dict) -> None:
        try:
            response = self.http.post(
                f"{self.base}/rest/v1/devices",
                headers={"Content-Type": "application/json", "Prefer": "return=minimal"},
                json=payload,
            )
        except httpx.HTTPError as exc:
            raise CloudUnavailable(type(exc).__name__) from None
        if response.status_code == 409:
            # Unique violation on device_code (or a duplicate device_id retry).
            raise CloudCodeTaken(payload.get("device_code"))
        if response.status_code >= 400:
            raise CloudUnavailable(f"Supabase HTTP {response.status_code} at /rest/v1/devices")

    def update_device(self, device_id: str, fields: dict) -> None:
        self._request(
            "PATCH",
            "/rest/v1/devices",
            params={"device_id": f"eq.{device_id}"},
            headers={"Content-Type": "application/json", "Prefer": "return=minimal"},
            json=fields,
        )

    def delete_device_row(self, device_id: str) -> None:
        self._request("DELETE", "/rest/v1/devices", params={"device_id": f"eq.{device_id}"})

    def purge_device(self, farm_id: str, device_id: str) -> int:
        """Delete everything the cloud holds for one device. Idempotent; returns media count."""
        prefix = f"farms/{farm_id}/devices/{device_id}/"
        rows = self._request(
            "GET",
            "/rest/v1/detections",
            params={
                "select": "image_url,annotated_image_path",
                "device_id": f"eq.{device_id}",
                "limit": 10000,
            },
        ).json()
        keys = sorted(
            {
                key
                for row in rows
                for key in (row.get("image_url"), row.get("annotated_image_path"))
                # Only objects under this device's own prefix may be removed.
                if isinstance(key, str) and key.startswith(prefix)
            }
        )
        for start in range(0, len(keys), 100):
            self._request(
                "DELETE",
                f"/storage/v1/object/{quote(BUCKET)}",
                ok_404=True,
                json={"prefixes": keys[start:start + 100]},
            )
        # Children before parent. alerts -> detections (alerts.detection_id), then device.
        for table in ("alerts", "detections", "device_storage_settings"):
            self._request(
                "DELETE",
                f"/rest/v1/{table}",
                ok_404=True,  # table not present in this cloud schema
                params={"device_id": f"eq.{device_id}"},
            )
        self.delete_device_row(device_id)
        return len(keys)


def get_device_cloud():
    """FastAPI dependency. Returns None when cloud writes are disabled (local-only mode)."""
    if not settings.DEVICE_CLOUD_WRITE_ENABLED:
        yield None
        return
    try:
        cloud = DeviceCloud(settings.SUPABASE_URL, settings.SUPABASE_KEY)
    except CloudUnavailable:
        # Enabled but misconfigured: fail closed in the route (503), never silently local.
        yield False
        return
    try:
        yield cloud
    finally:
        cloud.close()
