import { AlertType } from '../types/alert';

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  low_production_warning: 'Low Production',
  device_offline: 'Device Offline',
  detection_failed: 'Detection Failed',
  stale_data: 'Stale Data',
};

export function formatTimeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.max(0, Math.round(diffMs / 60000));

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  const diffDay = Math.round(diffHour / 24);
  return `${diffDay}d ago`;
}
