import type { MonitoringSettings } from '../types/settings';

import { apiGet, apiPut } from './apiClient';

type FarmingType = 'caged' | 'free_range';

interface ApiMonitoringSettings
  extends MonitoringSettings {
  settings_id?: string | null;
  farm_id?: string | null;
  updated_at?: string | null;
}

interface MonitoringSettingsPayload {
  monitoring_enabled: boolean;
  monitoring_start_time: string | null;
  monitoring_end_time: string | null;
  detection_mode: 'interval' | 'scheduled' | null;
  detection_interval_minutes: number | null;
  scheduled_times: string[] | null;
  cage_warning_low_ratio_threshold: number | null;
  result_snapshot_interval_minutes: number | null;
  free_range_warning_low_count_threshold: number | null;
}

function toMonitoringSettings(
  raw: ApiMonitoringSettings
): MonitoringSettings {
  return {
    farming_type: raw.farming_type,
    monitoring_enabled: raw.monitoring_enabled,
    monitoring_start_time:
      raw.monitoring_start_time,
    monitoring_end_time:
      raw.monitoring_end_time,
    detection_mode: raw.detection_mode,
    detection_interval_minutes:
      raw.detection_interval_minutes,
    scheduled_times: raw.scheduled_times,
    cage_warning_low_ratio_threshold:
      raw.cage_warning_low_ratio_threshold,
    result_snapshot_interval_minutes:
      raw.result_snapshot_interval_minutes,
    free_range_warning_low_count_threshold:
      raw.free_range_warning_low_count_threshold,
  };
}

function toMonitoringPayload(
  value: MonitoringSettings
): MonitoringSettingsPayload {
  return {
    monitoring_enabled:
      value.monitoring_enabled,
    monitoring_start_time:
      value.monitoring_start_time,
    monitoring_end_time:
      value.monitoring_end_time,
    detection_mode:
      value.detection_mode,
    detection_interval_minutes:
      value.detection_interval_minutes,
    scheduled_times:
      value.scheduled_times,
    cage_warning_low_ratio_threshold:
      value.cage_warning_low_ratio_threshold,
    result_snapshot_interval_minutes:
      value.result_snapshot_interval_minutes,
    free_range_warning_low_count_threshold:
      value.free_range_warning_low_count_threshold,
  };
}

export async function getMonitoringSettings(
  type: FarmingType
): Promise<MonitoringSettings> {
  const raw =
    await apiGet<ApiMonitoringSettings>(
      `/monitoring-settings/${type}`
    );

  if (raw.farming_type !== type) {
    throw new Error(
      'Monitoring settings response mismatch.'
    );
  }

  return toMonitoringSettings(raw);
}

export async function saveMonitoringSettings(
  value: MonitoringSettings
): Promise<MonitoringSettings> {
  const raw =
    await apiPut<ApiMonitoringSettings>(
      `/monitoring-settings/${value.farming_type}`,
      toMonitoringPayload(value)
    );

  if (
    raw.farming_type !==
    value.farming_type
  ) {
    throw new Error(
      'Monitoring settings response mismatch.'
    );
  }

  return toMonitoringSettings(raw);
}

interface ApiNotificationSettings {
  in_app_enabled: boolean;
  email_enabled: boolean;
  push_enabled: boolean;
}

export interface AlertNotificationSettings {
  in_app_enabled: boolean;
}

/** Whether active alerts are shown in the app header (Web: Alert Settings). */
export async function getAlertNotificationSettings(
  _id = '',
  signal?: AbortSignal
): Promise<AlertNotificationSettings> {
  const raw = await apiGet<ApiNotificationSettings>('/notification-settings', signal);
  return { in_app_enabled: raw.in_app_enabled };
}

export async function saveAlertNotificationSettings(
  value: AlertNotificationSettings
): Promise<AlertNotificationSettings> {
  // Email / push delivery does not exist in this system, so they stay off.
  const raw = await apiPut<ApiNotificationSettings>('/notification-settings', {
    in_app_enabled: value.in_app_enabled,
    email_enabled: false,
    push_enabled: false,
  });
  return { in_app_enabled: raw.in_app_enabled };
}
