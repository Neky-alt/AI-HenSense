export type FarmingType = 'caged' | 'free_range';
export type DeviceStatus = 'online' | 'offline' | 'error';
export type MonitoringStatus = 'normal' | 'warning';
export type ChickenClassification = 'normal' | 'low';
export type CaptureSourceType = 'pi_camera' | 'mobile_camera' | 'file_upload';

export interface RecentChicken {
  classification: ChickenClassification;
  confidence: number;
}

export interface Device {
  device_id: string;
  device_code: string;
  device_name: string;
  farming_type: FarmingType;
  device_status: DeviceStatus;
  monitoring_status: MonitoringStatus | null;
  normal_count: number;
  low_count: number;
  total_count: number;
  normal_ratio: number | null;
  low_ratio: number | null;
  latest_detection_id?: string | null;
  annotated_image_url?: string | null;
  image_url: string | null;
  last_updated: string; // legacy mock label; display is derived from detected_at when available
  detected_at?: string | null; // latest formal Detection timestamp (ISO 8601 UTC)
  source_type?: CaptureSourceType;
  recent_chicken?: RecentChicken;
}
