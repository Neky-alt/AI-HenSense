export type AlertType = 'low_production_warning' | 'device_offline' | 'detection_failed' | 'stale_data';
export type AlertStatus = 'active' | 'resolved';

export interface Alert {
  alert_id: string;
  device_id: string;
  alert_type: AlertType;
  alert_status: AlertStatus;
  message: string;
  created_at: string;
  resolved_at?: string | null;
}
