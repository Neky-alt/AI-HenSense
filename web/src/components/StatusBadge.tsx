import type { DeviceStatus, MonitoringStatus } from "../types/device";

interface Props {
  status: DeviceStatus | MonitoringStatus | null;
}

export default function StatusBadge({ status }: Props) {
  if (status === null) return <span className="status-badge status-no-data">No current data</span>;
  const label = status.charAt(0).toUpperCase() + status.slice(1).replace("_", " ");
  return <span className={`status-badge status-${status}`}>{label}</span>;
}
