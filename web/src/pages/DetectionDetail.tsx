import { useNavigate, useParams } from "react-router-dom";
import { loadDevice, loadDetections } from "../services/detectionService";
import { useBackendData } from "../hooks/useBackendData";
import BackendStatus from "../components/BackendStatus";
import DetectionMedia from "../components/DetectionMedia";
import AppHeader from "../components/AppHeader";
import InfoTooltip from "../components/InfoTooltip";
import { MONITORING_STATUS_CLASS, MONITORING_STATUS_LABEL } from "../config/monitoringStatus";
import { detectionTriggerLabel } from "../utils/detectionDisplay";
import { formatRatio } from "../utils/ratio";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function DetectionDetail() {
  const { id, detectionId } = useParams<{ id: string; detectionId: string }>();
  const navigate = useNavigate();
  const deviceRequest = useBackendData(loadDevice, id);
  const historyRequest = useBackendData(loadDetections, id);
  const device = deviceRequest.data;
  const allDetections = historyRequest.data ?? [];
  const detection = allDetections.find((item) => item.detection_id === detectionId && item.device_id === id);
  const loading = deviceRequest.loading || historyRequest.loading;
  const error = deviceRequest.error || historyRequest.error;
  if (loading || error) return <div className="app"><AppHeader /><main className="dashboard"><button className="back-button" onClick={() => navigate(`/devices/${id}/history`)}>← Back</button><BackendStatus loading={loading} error={error} retry={() => { deviceRequest.retry(); historyRequest.retry(); }} /></main></div>;

  if (!device || !detection) {
    return <div className="app"><AppHeader /><main className="dashboard"><button className="back-button" onClick={() => navigate(device ? `/devices/${device.device_id}` : "/")}>← Back</button><p>Detection not found.</p></main></div>;
  }

  const currentIndex = allDetections.findIndex((d) => d.detection_id === detection.detection_id);
  const previousDetection = allDetections[currentIndex + 1];
  const nextDetection = allDetections[currentIndex - 1];
  const isFreeRange = device.farming_type === "free_range";

  return (
    <div className="app">
      <AppHeader />
      <main className="dashboard">
        <button className="back-button" onClick={() => navigate(`/devices/${device.device_id}`)}>← Back to {device.device_name}</button>
        <div className="page-title-row"><h1>Detection Detail</h1><InfoTooltip label={isFreeRange ? "Ratios describe only this result snapshot. Free-range Warning is based on Low Count across consecutive snapshots." : "Cage Low-production Ratio is used with the user-configured threshold. Backend confirmation will require two consecutive detections."} /></div>
        <div className="dd-device-meta"><span className="device-code">{device.device_code}</span><span>{formatDateTime(detection.detected_at)}</span><span>Source: {detection.source_type.replaceAll("_", " ")}</span><span>{detectionTriggerLabel(detection.trigger_type)}</span></div>

        <div className="dd-hero">
          <DetectionMedia key={detection.detection_id} original={detection.screenshot_url} annotated={detection.annotated_image_url} detectedAt={detection.detected_at} />
          <div className="dd-stats-panel">
            <div className="detail-dual-ratio">
              <div className="dd-ratio-block"><span className="dd-ratio-label">Normal Ratio</span><span className="dd-ratio-value">{formatRatio(detection.normal_ratio)}</span></div>
              <div className="dd-ratio-block dd-ratio-low"><span className="dd-ratio-label">{isFreeRange ? "Current Snapshot Low Ratio" : "Low-production Ratio"}</span><span className="dd-ratio-value">{formatRatio(detection.low_ratio)}</span></div>
            </div>
            <div className="monitoring-status-stack detail-status-stack"><span className="status-context-label">Monitoring Status</span><span className={MONITORING_STATUS_CLASS[detection.monitoring_status]}>{MONITORING_STATUS_LABEL[detection.monitoring_status]}</span></div>
            <div className="dd-count-list"><div className="dd-count-item"><span>Normal</span><span>{detection.normal_count}</span></div><div className="dd-count-item"><span>Low</span><span className="low-text">{detection.low_count}</span></div><div className="dd-count-item"><span>Total</span><span>{detection.total_count}</span></div></div>
          </div>
        </div>

        <p className="dd-confidence-note">AI classifications are research/demo estimates, not verified laying records.{isFreeRange && (detection.trigger_type === "manual" ? " This is a manual single-frame result, not a formal monitoring snapshot." : " Snapshot counts represent observations, not guaranteed unique hens.")}</p>
        <p className="dd-confidence-note">Confidence: {detection.confidence !== undefined ? `${detection.confidence}%` : "N/A (pending reliable AI metric)"}</p>
        <div className="dd-prev-next-row"><button className="dd-nav-button" disabled={!previousDetection} onClick={() => previousDetection && navigate(`/devices/${device.device_id}/detections/${previousDetection.detection_id}`)}>← Previous</button><button className="dd-nav-button" disabled={!nextDetection} onClick={() => nextDetection && navigate(`/devices/${device.device_id}/detections/${nextDetection.detection_id}`)}>Next →</button></div>
      </main>
    </div>
  );
}

export default DetectionDetail;
