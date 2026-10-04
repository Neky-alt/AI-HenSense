export type DetectionMode = "interval" | "scheduled";
export type FrequencyUnit = "minutes" | "hours" | "days";

export interface CageMonitoringSettings {
  monitoringEnabled: boolean;
  detectionMode: DetectionMode;
  // Stored in minutes regardless of how the user enters the value.
  detectionFrequencyMinutes: number;
  scheduledTimes: string[];
  captureStartTime: string;
  captureEndTime: string;
  // Stored as 0-1. UI displays 1-100%.
  lowProductionWarningThreshold: number;
}

export interface FreeRangeMonitoringSettings {
  monitoringEnabled: boolean;
  monitoringStartTime: string;
  monitoringEndTime: string;
  // Stored in minutes. AI inference itself remains a continuous Pi-side process.
  resultSnapshotFrequencyMinutes: number;
  lowCountWarningThreshold: number;
}

export interface AlertNotificationSettings {
  // Stored in the Backend (/notification-settings). Controls the in-app alert
  // badge and dropdown in the header. Email/push delivery does not exist.
  inAppEnabled: boolean;
}

export const DEFAULT_CAGE_MONITORING_SETTINGS: CageMonitoringSettings = {
  monitoringEnabled: true,
  detectionMode: "scheduled",
  detectionFrequencyMinutes: 30,
  scheduledTimes: ["12:00"],
  captureStartTime: "10:00",
  captureEndTime: "14:00",
  lowProductionWarningThreshold: 0.6,
};

export const DEFAULT_FREE_RANGE_MONITORING_SETTINGS: FreeRangeMonitoringSettings = {
  monitoringEnabled: true,
  monitoringStartTime: "08:00",
  monitoringEndTime: "18:00",
  resultSnapshotFrequencyMinutes: 5,
  lowCountWarningThreshold: 3,
};

export const DEFAULT_ALERT_NOTIFICATION_SETTINGS: AlertNotificationSettings = {
  inAppEnabled: true,
};
