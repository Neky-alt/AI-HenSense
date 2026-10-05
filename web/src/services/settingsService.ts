import { apiGet, apiPut } from "./apiClient";
import {
  DEFAULT_CAGE_MONITORING_SETTINGS,
  DEFAULT_FREE_RANGE_MONITORING_SETTINGS,
  type AlertNotificationSettings,
  type CageMonitoringSettings,
  type FreeRangeMonitoringSettings,
} from "../types/settings";

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

interface BackendFreeRangeMonitoringSettings {
  monitoring_enabled: boolean;
  monitoring_start_time: string | null;
  monitoring_end_time: string | null;
  result_snapshot_interval_minutes: number | null;
  free_range_warning_low_count_threshold: number | null;
}

function mapBackendFreeRangeSettings(
  raw: BackendFreeRangeMonitoringSettings
): FreeRangeMonitoringSettings {
  return {
    monitoringEnabled: raw.monitoring_enabled,
    monitoringStartTime:
      raw.monitoring_start_time ?? DEFAULT_FREE_RANGE_MONITORING_SETTINGS.monitoringStartTime,
    monitoringEndTime:
      raw.monitoring_end_time ?? DEFAULT_FREE_RANGE_MONITORING_SETTINGS.monitoringEndTime,
    resultSnapshotFrequencyMinutes:
      raw.result_snapshot_interval_minutes ??
      DEFAULT_FREE_RANGE_MONITORING_SETTINGS.resultSnapshotFrequencyMinutes,
    lowCountWarningThreshold:
      raw.free_range_warning_low_count_threshold ??
      DEFAULT_FREE_RANGE_MONITORING_SETTINGS.lowCountWarningThreshold,
  };
}

export async function getFreeRangeMonitoringSettings(): Promise<FreeRangeMonitoringSettings> {
  return mapBackendFreeRangeSettings(
    await apiGet<BackendFreeRangeMonitoringSettings>("/monitoring-settings/free_range")
  );
}

export async function updateFreeRangeMonitoringSettings(
  settings: FreeRangeMonitoringSettings
): Promise<FreeRangeMonitoringSettings> {
  const raw = await apiPut<BackendFreeRangeMonitoringSettings>(
    "/monitoring-settings/free_range",
    {
      monitoring_enabled: settings.monitoringEnabled,
      monitoring_start_time: settings.monitoringStartTime,
      monitoring_end_time: settings.monitoringEndTime,
      detection_mode: null,
      detection_interval_minutes: null,
      scheduled_times: null,
      cage_warning_low_ratio_threshold: null,
      result_snapshot_interval_minutes: settings.resultSnapshotFrequencyMinutes,
      free_range_warning_low_count_threshold: settings.lowCountWarningThreshold,
    }
  );
  return mapBackendFreeRangeSettings(raw);
}

interface BackendNotificationSettings {
  in_app_enabled: boolean;
  email_enabled: boolean;
  push_enabled: boolean;
}

export async function getAlertNotificationSettings(
  signal?: AbortSignal
): Promise<AlertNotificationSettings> {
  const raw = await apiGet<BackendNotificationSettings>("/notification-settings", signal);
  return { inAppEnabled: raw.in_app_enabled };
}

/** useBackendData loader for the header alert badge. */
export function loadAlertNotificationSettings(
  _id: string,
  signal: AbortSignal
): Promise<AlertNotificationSettings> {
  return getAlertNotificationSettings(signal);
}

export async function updateAlertNotificationSettings(
  settings: AlertNotificationSettings
): Promise<AlertNotificationSettings> {
  // Email / push delivery does not exist in this system, so they stay off.
  const raw = await apiPut<BackendNotificationSettings>("/notification-settings", {
    in_app_enabled: settings.inAppEnabled,
    email_enabled: false,
    push_enabled: false,
  });
  return { inAppEnabled: raw.in_app_enabled };
}
