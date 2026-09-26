import type { Alert } from "../types/alert";

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60 * 1000).toISOString();

export const mockAlerts: Alert[] = [
  {
    alert_id: "a1",
    device_id: "4",
    alert_type: "device_offline",
    alert_status: "active",
    message: "Cage C-04 is offline. The alert will resolve automatically when the device reconnects.",
    created_at: minutesAgo(12),
    resolved_at: null,
  },
  {
    alert_id: "a2",
    device_id: "3",
    alert_type: "low_production_warning",
    alert_status: "active",
    message: "Low-production ratio exceeded the configured cage threshold for two consecutive detections.",
    created_at: minutesAgo(5),
    resolved_at: null,
  },
  {
    alert_id: "a3",
    device_id: "5",
    alert_type: "low_production_warning",
    alert_status: "active",
    message: "Low count reached the configured free-range threshold for two consecutive snapshots.",
    created_at: minutesAgo(45),
    resolved_at: null,
  },
  {
    alert_id: "a4",
    device_id: "6",
    alert_type: "detection_failed",
    alert_status: "active",
    message: "AI inference failed for the latest scheduled snapshot. The system will retry on a later detection.",
    created_at: minutesAgo(20),
    resolved_at: null,
  },
  {
    alert_id: "a5",
    device_id: "2",
    alert_type: "stale_data",
    alert_status: "resolved",
    message: "No fresh detection data was received within the expected monitoring interval.",
    created_at: minutesAgo(28),
    resolved_at: minutesAgo(8),
  },
];

export function getAlerts(): Alert[] {
  return [...mockAlerts].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export function getActiveAlerts(): Alert[] {
  return getAlerts().filter((alert) => alert.alert_status === "active");
}
