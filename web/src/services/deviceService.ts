// Device Management (docs/DEVICE_MANAGEMENT_API.md). Every write goes to the Backend;
// nothing is kept in browser storage.
import type { FarmingType } from "../types/device.ts";
import { apiDelete, apiGet, apiPatch, apiPost } from "./apiClient.ts";
import type { ApiDevice } from "./detectionService.ts";

export const DEVICE_CODE_PATTERN = /^[A-Z0-9-]{3,32}$/;
export const DEVICE_NAME_MAX_LENGTH = 64;

/** Same normalisation as the Backend: trim + upper-case. */
export function normalizeDeviceCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export type DeviceField = "device_code" | "device_name" | "farming_type";

/** Client-side pre-check only; the Backend response is authoritative. */
export function validateDeviceInput(code: string, name: string): { field: DeviceField; message: string } | null {
  if (!DEVICE_CODE_PATTERN.test(normalizeDeviceCode(code))) {
    return { field: "device_code", message: "Device ID must be 3–32 letters, numbers or hyphens." };
  }
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > DEVICE_NAME_MAX_LENGTH) {
    return { field: "device_name", message: `Enter a device name (up to ${DEVICE_NAME_MAX_LENGTH} characters).` };
  }
  return null;
}

/** Which form field a Backend error code belongs to, for highlighting. */
export function fieldForErrorCode(code: string | undefined): DeviceField | null {
  if (code === "DEVICE_CODE_TAKEN" || code === "DEVICE_CODE_RETIRED" || code === "INVALID_DEVICE_CODE") return "device_code";
  if (code === "INVALID_DEVICE_NAME") return "device_name";
  if (code === "INVALID_FARMING_TYPE") return "farming_type";
  return null;
}

export interface CreateDevicePayload {
  device_code: string;
  device_name: string;
  farming_type: FarmingType;
  farm_id?: string;
}

export function createDevice(payload: CreateDevicePayload): Promise<ApiDevice> {
  return apiPost<ApiDevice>("/devices", {
    ...payload,
    device_code: normalizeDeviceCode(payload.device_code),
    device_name: payload.device_name.trim(),
  });
}

export function renameDevice(deviceId: string, deviceName: string): Promise<ApiDevice> {
  return apiPatch<ApiDevice>(`/devices/${encodeURIComponent(deviceId)}`, { device_name: deviceName.trim() });
}

export interface RemoveDeviceResult {
  device_id: string;
  is_active: false;
  history_retained: true;
}

/** Soft delete: history is kept and the Device ID stays reserved. */
export function removeDevice(deviceId: string): Promise<RemoveDeviceResult> {
  return apiDelete<RemoveDeviceResult>(`/devices/${encodeURIComponent(deviceId)}`);
}

export interface PurgeDeviceResult {
  device_id: string;
  purged: true;
  detections_deleted: number;
  alerts_deleted: number;
  media_deleted: number;
}

/** Permanent: deletes the device and all history locally and in the cloud. */
export function purgeDevice(deviceId: string): Promise<PurgeDeviceResult> {
  return apiDelete<PurgeDeviceResult>(`/devices/${encodeURIComponent(deviceId)}?purge_history=true`);
}

export function loadRemovedDevices(signal?: AbortSignal): Promise<ApiDevice[]> {
  return apiGet<ApiDevice[]>("/devices/removed", signal);
}

export type DeleteMode = "remove" | "purge";

export function deleteSuccessMessage(mode: DeleteMode): string {
  return mode === "purge"
    ? "The device and all of its history have been permanently deleted."
    : "The device has been removed. Its detection history is kept.";
}
