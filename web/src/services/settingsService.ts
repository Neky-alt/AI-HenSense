import { apiGet, apiPut } from "./apiClient";
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

interface BackendCageMonitoringSettings {
  monitoring_enabled: boolean;
  monitoring_start_time: string | null;
  monitoring_end_time: string | null;
  detection_mode: "interval" | "scheduled";
  detection_interval_minutes: number | null;
  scheduled_times: string[] | null;
  cage_warning_low_ratio_threshold: number;
  result_snapshot_interval_minutes: number | null;
  free_range_warning_low_count_threshold: number | null;
}

function mapBackendCageSettings(
  raw: BackendCageMonitoringSettings
): CageMonitoringSettings {
  return {
    monitoringEnabled: raw.monitoring_enabled,
    detectionMode: raw.detection_mode,
    detectionFrequencyMinutes:
      raw.detection_interval_minutes ??
      DEFAULT_CAGE_MONITORING_SETTINGS.detectionFrequencyMinutes,
    scheduledTimes:
      raw.scheduled_times ??
      [...DEFAULT_CAGE_MONITORING_SETTINGS.scheduledTimes],
    captureStartTime:
      raw.monitoring_start_time ??
      DEFAULT_CAGE_MONITORING_SETTINGS.captureStartTime,
    captureEndTime:
      raw.monitoring_end_time ??
      DEFAULT_CAGE_MONITORING_SETTINGS.captureEndTime,
    lowProductionWarningThreshold:
      raw.cage_warning_low_ratio_threshold,
  };
}

export async function getCageMonitoringSettings(): Promise<CageMonitoringSettings> {
  const raw = await apiGet<BackendCageMonitoringSettings>(
    "/monitoring-settings/caged"
  );

  return mapBackendCageSettings(raw);
}

export async function updateCageMonitoringSettings(
  settings: CageMonitoringSettings
): Promise<CageMonitoringSettings> {
  const raw = await apiPut<BackendCageMonitoringSettings>(
    "/monitoring-settings/caged",
    {
      monitoring_enabled: settings.monitoringEnabled,
      monitoring_start_time: settings.captureStartTime,
      monitoring_end_time: settings.captureEndTime,
      detection_mode: settings.detectionMode,
      detection_interval_minutes: settings.detectionFrequencyMinutes,
      scheduled_times: settings.scheduledTimes,
      cage_warning_low_ratio_threshold:
        settings.lowProductionWarningThreshold,
      result_snapshot_interval_minutes: null,
      free_range_warning_low_count_threshold: null,
    }
  );

  return mapBackendCageSettings(raw);
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
