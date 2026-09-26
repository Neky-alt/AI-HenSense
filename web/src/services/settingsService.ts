import { localAccountKey } from "./accountRequest";
import {
  DEFAULT_ALERT_NOTIFICATION_SETTINGS,
  DEFAULT_CAGE_MONITORING_SETTINGS,
  DEFAULT_DEVICE_MEDIA_STORAGE_SETTINGS,
  DEFAULT_FREE_RANGE_MONITORING_SETTINGS,
  type AlertNotificationSettings,
  type CageMonitoringSettings,
  type DeviceMediaStorageSettings,
  type DeviceStorageStatus,
  type FreeRangeMonitoringSettings,
} from "../types/settings";

const CAGE_STORAGE_KEY = "country-watch-cage-monitoring-settings-v2";
const FREE_RANGE_STORAGE_KEY = "country-watch-free-range-monitoring-settings-v2";
const ALERT_STORAGE_KEY = "country-watch-alert-settings-v2";
const DEVICE_MEDIA_STORAGE_PREFIX = "country-watch-device-media-storage-v1";

function readSettings<T>(key: string, defaults: T): T {
  try {
    const stored = localStorage.getItem(localAccountKey(key));
    if (!stored) return structuredClone(defaults);
    return { ...structuredClone(defaults), ...(JSON.parse(stored) as Partial<T>) } as T;
  } catch {
    return structuredClone(defaults);
  }
}

export async function getCageMonitoringSettings(): Promise<CageMonitoringSettings> {
  type LegacyCageSettings = CageMonitoringSettings & {
    automaticDetection?: boolean;
    captureWindowEnabled?: boolean;
    screenshotFrequencyMinutes?: number;
    alertsEnabled?: boolean;
  };

  const stored = readSettings<LegacyCageSettings>(
    CAGE_STORAGE_KEY,
    DEFAULT_CAGE_MONITORING_SETTINGS
  );

  return {
    monitoringEnabled:
      typeof stored.monitoringEnabled === "boolean"
        ? stored.monitoringEnabled
        : stored.automaticDetection ?? true,
    detectionMode: stored.detectionMode ?? DEFAULT_CAGE_MONITORING_SETTINGS.detectionMode,
    detectionFrequencyMinutes:
      stored.detectionFrequencyMinutes ??
      DEFAULT_CAGE_MONITORING_SETTINGS.detectionFrequencyMinutes,
    scheduledTimes: Array.isArray(stored.scheduledTimes)
      ? [...stored.scheduledTimes]
      : [...DEFAULT_CAGE_MONITORING_SETTINGS.scheduledTimes],
    captureStartTime:
      stored.captureStartTime ?? DEFAULT_CAGE_MONITORING_SETTINGS.captureStartTime,
    captureEndTime:
      stored.captureEndTime ?? DEFAULT_CAGE_MONITORING_SETTINGS.captureEndTime,
    lowProductionWarningThreshold:
      stored.lowProductionWarningThreshold ??
      DEFAULT_CAGE_MONITORING_SETTINGS.lowProductionWarningThreshold,
  };
}

export async function updateCageMonitoringSettings(
  settings: CageMonitoringSettings
): Promise<CageMonitoringSettings> {
  localStorage.setItem(localAccountKey(CAGE_STORAGE_KEY), JSON.stringify(settings));
  return settings;
}

export async function getFreeRangeMonitoringSettings(): Promise<FreeRangeMonitoringSettings> {
  type LegacyFreeRangeSettings = FreeRangeMonitoringSettings & {
    continuousDetection?: boolean;
    alertsEnabled?: boolean;
  };

  const stored = readSettings<LegacyFreeRangeSettings>(
    FREE_RANGE_STORAGE_KEY,
    DEFAULT_FREE_RANGE_MONITORING_SETTINGS
  );

  return {
    monitoringEnabled:
      stored.monitoringEnabled ?? DEFAULT_FREE_RANGE_MONITORING_SETTINGS.monitoringEnabled,
    monitoringStartTime:
      stored.monitoringStartTime ?? DEFAULT_FREE_RANGE_MONITORING_SETTINGS.monitoringStartTime,
    monitoringEndTime:
      stored.monitoringEndTime ?? DEFAULT_FREE_RANGE_MONITORING_SETTINGS.monitoringEndTime,
    resultSnapshotFrequencyMinutes:
      stored.resultSnapshotFrequencyMinutes ??
      DEFAULT_FREE_RANGE_MONITORING_SETTINGS.resultSnapshotFrequencyMinutes,
    lowCountWarningThreshold:
      stored.lowCountWarningThreshold ??
      DEFAULT_FREE_RANGE_MONITORING_SETTINGS.lowCountWarningThreshold,
  };
}

export async function updateFreeRangeMonitoringSettings(
  settings: FreeRangeMonitoringSettings
): Promise<FreeRangeMonitoringSettings> {
  localStorage.setItem(localAccountKey(FREE_RANGE_STORAGE_KEY), JSON.stringify(settings));
  return settings;
}

export async function getAlertNotificationSettings(): Promise<AlertNotificationSettings> {
  return readSettings(ALERT_STORAGE_KEY, DEFAULT_ALERT_NOTIFICATION_SETTINGS);
}

export async function updateAlertNotificationSettings(
  settings: AlertNotificationSettings
): Promise<AlertNotificationSettings> {
  localStorage.setItem(localAccountKey(ALERT_STORAGE_KEY), JSON.stringify(settings));
  return settings;
}

function getDeviceMediaStorageKey(deviceId: string) {
  return `${DEVICE_MEDIA_STORAGE_PREFIX}:${deviceId}`;
}

export async function getDeviceMediaStorageSettings(
  deviceId: string
): Promise<DeviceMediaStorageSettings> {
  return readSettings(
    getDeviceMediaStorageKey(deviceId),
    DEFAULT_DEVICE_MEDIA_STORAGE_SETTINGS
  );
}

export async function updateDeviceMediaStorageSettings(
  deviceId: string,
  settings: DeviceMediaStorageSettings
): Promise<DeviceMediaStorageSettings> {
  localStorage.setItem(localAccountKey(getDeviceMediaStorageKey(deviceId)), JSON.stringify(settings));
  return settings;
}

// Frontend prototype only. BE-05 / Pi integration will replace these mock values
// with the real SD-card capacity and usage reported by the device.
export async function getDeviceStorageStatus(deviceId: string): Promise<DeviceStorageStatus> {
  const seed = [...deviceId].reduce((total, char) => total + char.charCodeAt(0), 0);
  const capacityGb = 128;
  const usedGb = 24 + (seed % 15);
  return {
    capacityGb,
    usedGb,
    availableGb: capacityGb - usedGb,
  };
}
