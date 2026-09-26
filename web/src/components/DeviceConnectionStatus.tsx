import type { DeviceStatus } from "../types/device";

interface Props {
  status: DeviceStatus;
}

const STATUS_LABEL: Record<DeviceStatus, string> = {
  online: "Online",
  offline: "Offline",
  error: "Error",
};

export default function DeviceConnectionStatus({ status }: Props) {
  return (
    <span className={`connection-indicator connection-${status}`}>
      <span className="connection-dot" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}
