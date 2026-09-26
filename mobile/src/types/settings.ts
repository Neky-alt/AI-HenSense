import type { AlertType } from './alert';

export type DetectionMode = 'interval' | 'scheduled';
export type StorageLimitAction = 'delete_oldest' | 'stop_recording';

export interface MonitoringSettings {
  farming_type: 'caged' | 'free_range';
  monitoring_enabled: boolean;
  monitoring_start_time: string;
  monitoring_end_time: string;
  detection_mode: DetectionMode | null;
  detection_interval_minutes: number | null;
  scheduled_times: string[] | null;
  cage_warning_low_ratio_threshold: number | null;
  result_snapshot_interval_minutes: number | null;
  free_range_warning_low_count_threshold: number | null;
}

export interface NotificationSettings {
  // Existing API contract. Email and push remain future fields and are not activated by V4.1.
  in_app_enabled: boolean;
  email_enabled: boolean;
  push_enabled: boolean;
  // V4.1 prototype-only AsyncStorage preferences; NOT a Backend field until contract update.
  alert_type_preferences: Record<AlertType, boolean>;
}

export interface DeviceStorageSettings {
  store_detection_images: boolean;
  detection_image_retention_days: number;
  store_video_locally: boolean;
  video_retention_days: number;
  max_media_storage_gb: number;
  storage_limit_action: StorageLimitAction;
}

export interface DeviceStorageStatus {
  capacity_gb: number;
  used_gb: number;
  available_gb: number;
}
