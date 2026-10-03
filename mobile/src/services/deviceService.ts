// Device Management (Add / Rename / Remove / Purge) — Backend contract
// DEVICE_MANAGEMENT_API.md. Device code and farming type are fixed after
// creation; only the name can change. Callers reload lists after success.
import { userMessage } from '../lib/userMessages';
import type { FarmingType } from '../types/device';
import { apiDelete, apiPatch, apiPost } from './apiClient';

export const DEVICE_CODE_PATTERN = /^[A-Z0-9-]{3,32}$/;
export const DEVICE_NAME_MAX = 64;

/** Management needs the local Backend; cloud snapshot mode is read-only. */
export const deviceManagementEnabled = () =>
  process.env.EXPO_PUBLIC_DATA_SOURCE !== 'cloud';

export const normalizeDeviceCode = (value: string) =>
  value.trim().toUpperCase();

export type DeviceField = 'device_code' | 'device_name' | 'farming_type';
export interface DeviceFormError { message: string; field?: DeviceField }

export interface CreateDevicePayload {
  device_code: string;
  device_name: string;
  farming_type: FarmingType;
  farm_id?: string;
}

export interface ManagedDevice {
  device_id: string;
  device_code: string;
  device_name: string;
  farming_type: FarmingType;
}

export interface RemoveDeviceResult {
  device_id: string;
  is_active?: boolean;
  history_retained?: boolean;
  purged?: boolean;
}

const CODE_MESSAGE = 'Device ID must be 3–32 letters, numbers or hyphens.';
const NAME_MESSAGE = `Enter a device name (up to ${DEVICE_NAME_MAX} characters).`;

/** Same rules the Backend applies; the Backend response remains authoritative. */
export function validateDeviceCode(code: string): DeviceFormError | null {
  return DEVICE_CODE_PATTERN.test(normalizeDeviceCode(code))
    ? null
    : { message: CODE_MESSAGE, field: 'device_code' };
}

export function validateDeviceName(name: string): DeviceFormError | null {
  const trimmed = name.trim();
  return trimmed && trimmed.length <= DEVICE_NAME_MAX
    ? null
    : { message: NAME_MESSAGE, field: 'device_name' };
}

const DEVICE_ERRORS: Record<string, DeviceFormError> = {
  DEVICE_CODE_TAKEN: { message: 'This Device ID is already registered.', field: 'device_code' },
  DEVICE_CODE_RETIRED: {
    message: 'This Device ID belongs to a removed device. Delete its history to reuse it.',
    field: 'device_code',
  },
  INVALID_DEVICE_CODE: { message: CODE_MESSAGE, field: 'device_code' },
  INVALID_DEVICE_NAME: { message: NAME_MESSAGE, field: 'device_name' },
  INVALID_FARMING_TYPE: { message: 'Choose a farming type.', field: 'farming_type' },
  VALIDATION_ERROR: { message: 'Check your input and try again.' },
  FARM_NOT_FOUND: { message: 'You need a farm before adding devices.' },
  NOT_FOUND: { message: 'This device is no longer available. Please refresh.' },
  CLOUD_UNAVAILABLE: { message: 'Unable to reach the cloud right now. Nothing was changed. Please try again.' },
};

/** Maps a Device Management failure to an English message and the field to highlight. */
export function deviceError(error: unknown, fallback: string): DeviceFormError {
  const code = (error as { code?: string } | null)?.code;
  if (code && Object.hasOwn(DEVICE_ERRORS, code)) return DEVICE_ERRORS[code];
  return { message: userMessage(error, fallback) };
}

export function createDevice(payload: CreateDevicePayload) {
  return apiPost<ManagedDevice>('/devices', {
    ...payload,
    device_code: normalizeDeviceCode(payload.device_code),
    device_name: payload.device_name.trim(),
  });
}

export function renameDevice(deviceId: string, deviceName: string) {
  return apiPatch<ManagedDevice>(`/devices/${encodeURIComponent(deviceId)}`, {
    device_name: deviceName.trim(),
  });
}

/** Default keeps history (soft remove). purgeHistory deletes everything and cannot be undone. */
export function removeDevice(deviceId: string, { purgeHistory = false } = {}) {
  const query = purgeHistory ? '?purge_history=true' : '';
  return apiDelete<RemoveDeviceResult>(`/devices/${encodeURIComponent(deviceId)}${query}`);
}
