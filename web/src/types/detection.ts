import type { CaptureSourceType, MonitoringStatus } from "./device";

export interface Detection {
  detection_id: string;
  device_id: string;
  detected_at: string;
  screenshot_url: string;
  annotated_image_url?: string;
  total_count: number;
  normal_count: number;
  low_count: number;
  // Data/API ratios use 0-1. UI converts them to percentages.
  normal_ratio: number | null;
  low_ratio: number | null;
  monitoring_status: MonitoringStatus;
  source_type: CaptureSourceType;
  source_id?: string | null;
  trigger_type?: "scheduled" | "manual" | "free_range_snapshot";
  // Confidence remains a display percentage until the AI interface is finalised.
  confidence?: number;
}
