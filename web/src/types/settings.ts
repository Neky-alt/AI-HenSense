export type DetectionMode = "interval" | "scheduled";
export type FrequencyUnit = "minutes" | "hours" | "days";
export type StorageLimitAction = "delete_oldest" | "stop_recording";

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
  notificationsEnabled: boolean;
  lowProductionWarningEnabled: boolean;
  deviceOfflineEnabled: boolean;
  detectionFailedEnabled: boolean;
  staleDataEnabled: boolean;
}

export interface DeviceMediaStorageSettings {
  storeDetectionImages: boolean;
  storeVideoLocally: boolean;
  maximumMediaStorageGb: number;
  detectionImageRetentionDays: number;
  videoRetentionDays: number;
  storageLimitAction: StorageLimitAction;
}

export interface DeviceStorageStatus {
  capacityGb: number;
  usedGb: number;
  availableGb: number;
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
  notificationsEnabled: true,
  lowProductionWarningEnabled: true,
  deviceOfflineEnabled: true,
  detectionFailedEnabled: true,
  staleDataEnabled: true,
};

export const DEFAULT_DEVICE_MEDIA_STORAGE_SETTINGS: DeviceMediaStorageSettings = {
  storeDetectionImages: true,
  storeVideoLocally: true,
  maximumMediaStorageGb: 80,
  detectionImageRetentionDays: 30,
  videoRetentionDays: 7,
  storageLimitAction: "delete_oldest",
};
