import type { Device } from "../types/device";
import { localAccountKey } from "../services/accountRequest";

const STORAGE_KEY = "poultry-monitor-devices";
const DEVICES_CHANGED_EVENT = "poultry-devices-changed";
const DEFAULT_CAGE_LOW_RATIO_THRESHOLD = 0.6;
const DEFAULT_FREE_RANGE_LOW_COUNT_THRESHOLD = 3;

function normaliseRatio(
  value: number | null | undefined,
  totalCount: number
): number | null {
  if (totalCount <= 0 || value === null || value === undefined) {
    return null;
  }

  // Migrate prototype data that previously stored percentages such as 82.
  return value > 1 ? value / 100 : value;
}

function normaliseMonitoringStatus(device: Device): Device["monitoring_status"] {
  const legacyStatus = (device as Device & { monitoring_status?: string }).monitoring_status;

  // Migrate any older locally stored prototype status into the current Normal/Warning model. Any legacy non-current status is reclassified using the current defaults.
  if (legacyStatus === "warning") return "warning";
  if (legacyStatus === "normal") return "normal";

  if (device.farming_type === "free_range") {
    return device.low_count >= DEFAULT_FREE_RANGE_LOW_COUNT_THRESHOLD
      ? "warning"
      : "normal";
  }

  const lowRatio = normaliseRatio(device.low_ratio, device.total_count);
  return (lowRatio ?? 0) >= DEFAULT_CAGE_LOW_RATIO_THRESHOLD
    ? "warning"
    : "normal";
}

function normaliseDevice(device: Device): Device {
  const normalRatio = normaliseRatio(device.normal_ratio, device.total_count);
  const lowRatio = normaliseRatio(device.low_ratio, device.total_count);

  return {
    ...device,
    monitoring_status: normaliseMonitoringStatus({
      ...device,
      normal_ratio: normalRatio,
      low_ratio: lowRatio,
    }),
    normal_ratio: normalRatio,
    low_ratio: lowRatio,
    source_type: device.source_type ?? "pi_camera",
  };
}

function saveDevices(devices: Device[]) {
  localStorage.setItem(localAccountKey(STORAGE_KEY), JSON.stringify(devices));
  window.dispatchEvent(new Event(DEVICES_CHANGED_EVENT));
}

export function getDevices(): Device[] {
  let key:string;
  try{key=localAccountKey(STORAGE_KEY);}catch{return [];}
  const stored = localStorage.getItem(key);

  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Device[];
      const normalised = parsed.map(normaliseDevice);
      localStorage.setItem(localAccountKey(STORAGE_KEY), JSON.stringify(normalised));
      return normalised;
    } catch {
      localStorage.removeItem(localAccountKey(STORAGE_KEY));
    }
  }

  return []; // Never seed another account with prototype Demo devices.
}

export function getDeviceById(deviceId: string): Device | undefined {
  return getDevices().find((device) => device.device_id === deviceId);
}

export function addDevice(device: Device) {
  const devices = getDevices();
  saveDevices([...devices, normaliseDevice(device)]);
}

export function updateDevice(updatedDevice: Device) {
  const devices = getDevices();
  const updatedDevices = devices.map((device) =>
    device.device_id === updatedDevice.device_id
      ? normaliseDevice(updatedDevice)
      : device
  );
  saveDevices(updatedDevices);
}

export function deleteDevice(deviceId: string) {
  const devices = getDevices();
  const updatedDevices = devices.filter(
    (device) => device.device_id !== deviceId
  );
  saveDevices(updatedDevices);
}

export const DEVICE_CHANGE_EVENT = DEVICES_CHANGED_EVENT;
