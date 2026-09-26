export type FarmingType = "caged" | "free_range";

export type DeviceStatus = "online" | "offline" | "error";

export type MonitoringStatus = "normal" | "warning";

export type ChickenClassification = "normal" | "low";

export type CaptureSourceType = "pi_camera" | "mobile_camera" | "file_upload";

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

  // Data/API ratios use 0-1. UI converts them to percentages.
  normal_ratio: number | null;
  low_ratio: number | null;

  image_url: string;
  annotated_image_url?: string;
  last_updated: string;

  // Current prototype source. Additional source types are reserved for future expansion.
  source_type?: CaptureSourceType;

  // Free-range only. Kept for the current prototype pending product review.
  recent_chicken?: RecentChicken;
}
