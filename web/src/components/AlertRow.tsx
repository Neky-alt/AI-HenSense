import { useNavigate } from "react-router-dom";

import { getDeviceById } from "../utils/deviceStorage";
import { ALERT_TYPE_LABEL, formatTimeAgo } from "../utils/alertDisplay";
import type { Alert } from "../types/alert";
import Icon from "./Icon";

interface Props { alert: Alert; onNavigate?: () => void; }

export default function AlertRow({ alert, onNavigate }: Props) {
  const navigate = useNavigate();
  const device = getDeviceById(alert.device_id);

  const tone = alert.alert_type === "device_offline"
    ? "offline"
    : alert.alert_type === "stale_data"
      ? "stale"
      : alert.alert_type === "detection_failed"
        ? "failed"
        : "warning";

  const handleClick = () => {
    navigate(`/devices/${alert.device_id}`);
    onNavigate?.();
  };

  return (
    <button className="dd-alert-row modern-alert-row" onClick={handleClick}>
      <span className={`alert-leading-icon alert-leading-${tone}`}>
        <Icon name={tone === "offline" ? "device" : tone === "stale" ? "info" : "warning"} size={17} />
      </span>
      <div className="dd-alert-info">
        <strong>{device ? device.device_name : "Unknown Device"}</strong>
        <span className={`alert-type-chip alert-type-${tone}`}>{ALERT_TYPE_LABEL[alert.alert_type]}</span>
        <span className="dd-alert-message">{alert.message}</span>
      </div>
      <div className="dd-alert-meta">
        <span className={`alert-lifecycle-badge alert-lifecycle-${alert.alert_status}`}>{alert.alert_status === "active" ? "Active" : "Resolved"}</span>
        <span className="dd-alert-time">{formatTimeAgo(alert.created_at)}</span>
        <Icon name="chevron" size={16} />
      </div>
    </button>
  );
}
