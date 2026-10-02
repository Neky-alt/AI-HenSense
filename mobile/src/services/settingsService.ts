import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  DeviceStorageSettings,
  DeviceStorageStatus,
  MonitoringSettings,
  NotificationSettings,
} from '../types/settings';

import { accountStorageKey } from './accountScope';
import { apiGet, apiPut } from './apiClient';

const NOTIFY_KEY = '@country-watch/settings/notify-v2';

const alertDefaults: NotificationSettings['alert_type_preferences'] = {
  low_production_warning: true,
  device_offline: true,
  detection_failed: true,
  stale_data: true,
};

const notifyDefault: NotificationSettings = {
  in_app_enabled: true,
  email_enabled: false,
  push_enabled: false,
  alert_type_preferences: alertDefaults,
};

const storageDefault = (
  free: boolean
): DeviceStorageSettings => ({
  store_detection_images: true,
  detection_image_retention_days: 30,
  store_video_locally: free,
  video_retention_days: 7,
  max_media_storage_gb: 80,
  storage_limit_action: 'delete_oldest',
});

async function read<T>(
  key: string,
  fallback: T
): Promise<T> {
  const raw = await AsyncStorage.getItem(
    await accountStorageKey(key)
  );

  return raw
    ? (JSON.parse(raw) as T)
    : fallback;
}

async function write<T>(
  key: string,
  value: T
): Promise<T> {
  await AsyncStorage.setItem(
    await accountStorageKey(key),
    JSON.stringify(value)
  );

  return value;
}

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

export const getNotificationSettings =
  async (): Promise<NotificationSettings> => {
    const stored =
      await read<Partial<NotificationSettings>>(
        NOTIFY_KEY,
        notifyDefault
      );

    return {
      ...notifyDefault,
      ...stored,
      alert_type_preferences: {
        ...alertDefaults,
        ...stored.alert_type_preferences,
      },
    };
  };

export const saveNotificationSettings = (
  value: NotificationSettings
) => write(NOTIFY_KEY, value);

export const getDeviceStorageSettings = (
  deviceId: string,
  free: boolean
) =>
  read(
    `@country-watch/storage/${deviceId}-v2`,
    storageDefault(free)
  );

export const saveDeviceStorageSettings = (
  deviceId: string,
  value: DeviceStorageSettings
) =>
  write(
    `@country-watch/storage/${deviceId}-v2`,
    value
  );

export const getDeviceStorageStatus =
  async (
    _deviceId: string
  ): Promise<DeviceStorageStatus> => ({
    capacity_gb: 128,
    used_gb: 32,
    available_gb: 96,
  });
