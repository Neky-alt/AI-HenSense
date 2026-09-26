import type { MonitoringStatus } from "../types/device";

export const MONITORING_STATUS_OPTIONS: ReadonlyArray<{
  value: MonitoringStatus;
  label: string;
  tone: "normal" | "warning";
}> = [
  { value: "normal", label: "Normal", tone: "normal" },
  { value: "warning", label: "Warning", tone: "warning" },
];

export const MONITORING_STATUS_LABEL: Record<MonitoringStatus, string> = {
  normal: "Normal",
  warning: "Warning",
};

export const MONITORING_STATUS_CLASS: Record<MonitoringStatus, string> = {
  normal: "dd-status-badge dd-status-normal",
  warning: "dd-status-badge dd-status-warning",
};
