import type { CaptureSourceType, MonitoringStatus } from './device';

export interface Detection {
  detection_id: string;
  device_id: string;
  detected_at: string;
  screenshot_url: string | null;
  total_count: number;
  normal_count: number;
  low_count: number;
  normal_ratio: number | null;
  low_ratio: number | null;
  monitoring_status: MonitoringStatus;
  source_type: CaptureSourceType;
  trigger_type?: 'scheduled' | 'manual' | 'free_range_snapshot' | 'upload';
  annotated_image_url?: string | null;
  confidence?: number | null;
}
