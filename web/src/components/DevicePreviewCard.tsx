import { useNavigate } from "react-router-dom";
import type { Device } from "../types/device";
import StatusBadge from "./StatusBadge";
import DeviceConnectionStatus from "./DeviceConnectionStatus";
import { formatRatio } from "../utils/ratio";
import DetectionImage from "./DetectionImage";
import Icon from "./Icon";

interface Props { device: Device; }

export default function DevicePreviewCard({ device }: Props) {
  const navigate = useNavigate();
  const hasResult = device.monitoring_status !== null;
  const isRecorded = device.device_status !== "online" && hasResult;
  const isFreeRange = device.farming_type === "free_range";

  return (
    <article className="device-preview-card">
      <div className="device-preview-head">
        <div className="device-preview-title">
          <span className="device-preview-type-icon"><Icon name={isFreeRange ? "leaf" : "cage"} size={15} /></span>
          <div><strong>{device.device_name}</strong><span>{device.device_code}</span></div>
        </div>
        <DeviceConnectionStatus status={device.device_status} />
      </div>

      <div className="device-preview-image-shell">
        <DetectionImage src={device.annotated_image_url || device.image_url} fallbackSrc={device.image_url} alt={`${device.device_name} detection result image`} className="device-preview-image" />
      </div>

      <div className="preview-ratio-grid">
        <div><span>Normal Ratio</span><strong className={!hasResult ? "muted-value" : "normal-number"}>{!hasResult ? "--" : formatRatio(device.normal_ratio)}</strong></div>
        <div><span>{isFreeRange ? "Snapshot Low Ratio" : "Low-production Ratio"}</span><strong className={!hasResult ? "muted-value" : "low-number"}>{!hasResult ? "--" : formatRatio(device.low_ratio)}</strong></div>
      </div>

      <div className="device-preview-result">
        <div className="preview-monitoring-state"><span>{isRecorded ? "Last Recorded Result" : "Monitoring Status"}</span>{!hasResult ? <span className="status-badge status-no-data">No current data</span> : <StatusBadge status={device.monitoring_status} />}</div>
      </div>

      <div className="device-preview-counts">
        <div><span>Normal</span><strong>{!hasResult ? "--" : device.normal_count}</strong></div>
        <div><span>Low</span><strong>{!hasResult ? "--" : device.low_count}</strong></div>
        <div><span>Total</span><strong>{!hasResult ? "--" : device.total_count}</strong></div>
      </div>

      {hasResult && <p className="last-updated">{isRecorded ? "Recorded" : "Updated"} {device.last_updated}</p>}

      <button className="preview-details-button" onClick={() => navigate(`/devices/${device.device_id}`)}>View Details <Icon name="chevron" size={16} /></button>
    </article>
  );
}
