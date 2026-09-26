import { useNavigate } from "react-router-dom";

import type { Device } from "../types/device";
import StatusBadge from "./StatusBadge";
import DeviceConnectionStatus from "./DeviceConnectionStatus";
import { formatRatio } from "../utils/ratio";
import DetectionImage from "./DetectionImage";
import Icon from "./Icon";

interface Props {
  device: Device;
  onDelete?: (device: Device) => void;
}

export default function DeviceCard({ device, onDelete }: Props) {
  const navigate = useNavigate();
  const hasResult = device.monitoring_status !== null;
  const isOffline = device.device_status !== "online";
  const isFreeRange = device.farming_type === "free_range";
  const openDetails = () => navigate(`/devices/${device.device_id}`);

  return (
    <article
      className="device-card"
      onClick={openDetails}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") openDetails();
      }}
    >
      <div className="device-card-header modern-device-header">
        <div className="device-title-group">
          <span className="device-title-icon"><Icon name={isFreeRange ? "leaf" : "cage"} size={18} /></span>
          <div className="device-title-copy">
            <h3>{device.device_name}</h3>
            <span className="device-code">{device.device_code}</span>
          </div>
        </div>

        <DeviceConnectionStatus status={device.device_status} />
      </div>

      <div className="device-card-content">
        <div className="device-image-shell">
          <DetectionImage
            className="device-image"
            src={device.annotated_image_url || device.image_url} fallbackSrc={device.image_url}
            alt={`${device.device_name} latest monitoring screenshot`}
          />
          <span className="image-caption">{isOffline && hasResult ? "Last Recorded Result" : "Latest Screenshot"}</span>
        </div>

        <div className="device-card-metrics">
          <div className="dual-ratio-grid card-dual-ratio">
            <div className="ratio-stat ratio-stat-normal">
              <span>Normal Ratio</span>
              <strong>{!hasResult ? "--" : formatRatio(device.normal_ratio)}</strong>
              {hasResult && <div className="ratio-bar"><div className="ratio-bar-fill" style={{ width: `${(device.normal_ratio ?? 0) * 100}%` }} /></div>}
            </div>
            <div className="ratio-stat ratio-stat-low">
              <span>{isFreeRange ? "Current Snapshot Low Ratio" : "Low-production Ratio"}</span>
              <strong>{!hasResult ? "--" : formatRatio(device.low_ratio)}</strong>
              {hasResult && <div className="ratio-bar low-ratio-bar"><div className="ratio-bar-fill" style={{ width: `${(device.low_ratio ?? 0) * 100}%` }} /></div>}
            </div>
          </div>

          <div className="monitoring-status-row">
            <span className="status-context-label">{isOffline && hasResult ? "Recorded Monitoring Status" : "Monitoring Status"}</span>
            {!hasResult ? <span className="status-badge status-no-data">No current data</span> : <StatusBadge status={device.monitoring_status} />}
          </div>

          <div className="device-counts">
            <div><span>Normal</span><strong>{!hasResult ? "--" : device.normal_count}</strong></div>
            <div><span>Low</span><strong className={!hasResult ? "" : "low-text"}>{!hasResult ? "--" : device.low_count}</strong></div>
            <div><span>Total</span><strong>{!hasResult ? "--" : device.total_count}</strong></div>
          </div>
        </div>
      </div>

      <div className="device-footer">
        <span className="updated-label"><Icon name="clock" size={15} /> {isOffline && hasResult ? "Recorded" : "Updated"} {device.last_updated}</span>
        <div className="device-card-actions">
          <button className="details-button" onClick={(event) => { event.stopPropagation(); openDetails(); }}>View Details <Icon name="chevron" size={15} /></button>
          <button className="edit-device-button" disabled title="Device editing is not connected to the Backend" onClick={(event) => { event.stopPropagation(); navigate(`/devices/${device.device_id}/edit`); }}><Icon name="edit" size={15} /> Edit</button>
          <button className="delete-device-button" disabled title="Device deletion is not available in the Backend API" onClick={(event) => { event.stopPropagation(); onDelete?.(device); }}><Icon name="trash" size={15} /> Delete</button>
        </div>
      </div>
    </article>
  );
}
