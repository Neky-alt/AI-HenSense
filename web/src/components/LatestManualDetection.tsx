import { Link } from "react-router-dom";
import type { Detection } from "../types/detection";
import type { Device } from "../types/device";
import DetectionImage from "./DetectionImage";
import DeviceConnectionStatus from "./DeviceConnectionStatus";
import { formatRatio } from "../utils/ratio";

export default function LatestManualDetection({ device, detection }: { device: Device; detection: Detection }) {
  // Never combine media from a different device or a formal record with this preview.
  if (detection.device_id !== device.device_id || detection.trigger_type !== "manual") return null;
  return <section className="free-range-camera-card" aria-labelledby="latest-manual-heading">
    <div className="free-range-card-header">
      <div><h2 id="latest-manual-heading">Latest Manual Detection</h2><span className="device-code">{device.device_code}</span></div>
      <DeviceConnectionStatus status={device.device_status} />
    </div>
    <p className="snapshot-rule-note">Manual single-frame result. Not included in automatic alerts or formal snapshot statistics.</p>
    <div className="free-range-image-wrapper">
      <DetectionImage className="free-range-image" src={detection.annotated_image_url || detection.screenshot_url} fallbackSrc={detection.screenshot_url} alt={`Manual detection result at ${detection.detected_at}`} />
    </div>
    <div className="free-range-count-grid">
      <div><span>Normal</span><strong className="normal-text">{detection.normal_count}</strong></div>
      <div><span>Low</span><strong className="low-text">{detection.low_count}</strong></div>
      <div><span>Total</span><strong>{detection.total_count}</strong></div>
    </div>
    <div className="dual-ratio-grid free-range-dual-ratio">
      <div className="ratio-stat ratio-stat-normal"><span>Manual Normal Ratio</span><strong>{formatRatio(detection.normal_ratio)}</strong></div>
      <div className="ratio-stat ratio-stat-low"><span>Manual Low Ratio</span><strong>{formatRatio(detection.low_ratio)}</strong></div>
    </div>
    <div className="free-range-update">
      <span>{device.device_status !== "online" ? "Last Recorded Result" : "Recorded Result"} · {new Date(detection.detected_at).toLocaleString()}</span>
      <Link className="details-button" to={`/devices/${device.device_id}/detections/${detection.detection_id}`}>View Detection Detail →</Link>
    </div>
  </section>;
}
