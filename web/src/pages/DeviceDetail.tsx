import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import AppHeader from "../components/AppHeader";
import DetectionHistory from "../components/DetectionHistory";
import DeviceConnectionStatus from "../components/DeviceConnectionStatus";
import Icon from "../components/Icon";
import InfoTooltip from "../components/InfoTooltip";
import { MONITORING_STATUS_CLASS, MONITORING_STATUS_LABEL } from "../config/monitoringStatus";
import { getDeviceStorageStatus } from "../services/settingsService";
import type { DeviceStorageStatus } from "../types/settings";
import { loadDevice, runManualDetection } from "../services/detectionService";
import { useBackendData } from "../hooks/useBackendData";
import BackendStatus from "../components/BackendStatus";
import DetectionImage from "../components/DetectionImage";
import { formatRatio } from "../utils/ratio";

const DEFAULT_STORAGE_STATUS: DeviceStorageStatus = {
  capacityGb: 128,
  usedGb: 32,
  availableGb: 96,
};

function DeviceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const request = useBackendData(loadDevice, id);
  const device = request.data;
  const [storageStatus, setStorageStatus] = useState<DeviceStorageStatus>(DEFAULT_STORAGE_STATUS);
  const [manualDetectionMessage, setManualDetectionMessage] = useState("");

  useEffect(() => {
    if (!id) return;
    getDeviceStorageStatus(id).then(setStorageStatus);
  }, [id]);

  useEffect(() => {
    if (!manualDetectionMessage) return;
    const timer = window.setTimeout(() => setManualDetectionMessage(""), 3600);
    return () => window.clearTimeout(timer);
  }, [manualDetectionMessage]);

  if (request.loading || request.error) return <div className="app"><AppHeader /><main className="dashboard"><button className="back-button" onClick={() => navigate(-1)}>← Back</button><BackendStatus {...request} /></main></div>;

  if (!device) {
    return (
      <div className="app">
        <AppHeader />
        <main className="dashboard">
          <button className="back-button" onClick={() => navigate("/")}>← Back</button>
          <p>Device not found.</p>
        </main>
      </div>
    );
  }

  const isOffline = device.device_status === "offline";
  const hasRecordedData = device.monitoring_status !== null;
  const isHistorical = device.device_status !== "online" && hasRecordedData;
  const isFreeRange = device.farming_type === "free_range";

const runDetectionNow = async () => {
  if (isOffline) return;

  try {
    const command = await runManualDetection(device.device_id);

    setManualDetectionMessage(
      `Detection requested. Command status: ${command.command_status}.`
    );
  } catch {
    setManualDetectionMessage(
      "Unable to start detection. Please try again."
    );
  }
};

  return (
    <div className="app">
      <AppHeader />
      <main className="dashboard">
        <button className="back-button" onClick={() => navigate(isFreeRange ? "/free-range" : "/cages")}>← Back</button>

        <div className="device-detail-heading-row">
          <div>
            <div className="page-title-row">
              <h1>{device.device_name}</h1>
              <InfoTooltip label={isFreeRange ? "Normal and Low are classifications for the latest snapshot. Free-range Warning uses Low Count across consecutive saved snapshots." : "Normal and Low are classifications. Cage Warning uses the configurable Low-production Ratio threshold across two consecutive detections."} />
            </div>
            <div className="dd-device-meta">
              <span className="device-code">{device.device_code}</span>
              {hasRecordedData && <span>{isHistorical ? "Last Recorded Result" : isFreeRange ? "Latest Formal Snapshot" : "Latest Detection"} · {device.last_updated}</span>}
              <DeviceConnectionStatus status={device.device_status} />
            </div>
          </div>

          <div className="device-detail-actions">
            <div className="device-action-with-info">
              <button
                type="button"
                className="device-detail-action-button primary"
                onClick={runDetectionNow}
                disabled={isOffline}
                title={isOffline ? "Device is offline" : "Run one manual detection now"}
              >
                <Icon name="chart" size={17} />
                Run Detection Now
              </button>
              <InfoTooltip label="Immediately capture one current frame from this device and run one AI detection. It can be used even when automatic monitoring is off, but it is unavailable while the device is offline." />
            </div>

            <div className="device-action-with-info">
              <button
                type="button"
                className="device-detail-action-button"
                onClick={() => navigate(`/devices/${device.device_id}/storage`)}
              >
                <Icon name="settings" size={17} />
                Storage Settings
              </button>
              <InfoTooltip
                label={
                  isFreeRange
                    ? "Manage this device's SD-card detection-image and local-video storage, media retention and storage-limit behaviour. Structured Detection History is managed separately."
                    : "Manage this Cage device's SD-card detection-image storage, image retention and storage-limit behaviour. Cage monitoring does not require continuous video recording."
                }
              />
            </div>
          </div>
        </div>

        {manualDetectionMessage && (
          <div className="device-action-message">{manualDetectionMessage}</div>
        )}

        <div className="dd-hero">
          <div className="dd-screenshot-box">
            <DetectionImage
              src={device.image_url}
              alt={`${device.device_name} latest detection`}
              className="dd-screenshot-image"
            />
          </div>
          <div className="dd-stats-panel">
            <div className="detail-dual-ratio">
              <div className="dd-ratio-block">
                <span className="dd-ratio-label">Normal Ratio</span>
                <span className="dd-ratio-value">{!hasRecordedData ? "--" : formatRatio(device.normal_ratio)}</span>
              </div>
              <div className="dd-ratio-block dd-ratio-low">
                <span className="dd-ratio-label">{isFreeRange ? "Current Snapshot Low Ratio" : "Low-production Ratio"}</span>
                <span className="dd-ratio-value">{!hasRecordedData ? "--" : formatRatio(device.low_ratio)}</span>
              </div>
            </div>
            <div className="monitoring-status-stack detail-status-stack">
              <span className="status-context-label">{isHistorical ? "Recorded Monitoring Status" : "Monitoring Status"}</span>
              {!hasRecordedData || device.monitoring_status === null ? (
                <span className="status-badge status-no-data">No current data</span>
              ) : (
                <span className={MONITORING_STATUS_CLASS[device.monitoring_status]}>
                  {MONITORING_STATUS_LABEL[device.monitoring_status]}
                </span>
              )}
            </div>
            <div className="dd-count-list">
              <div className="dd-count-item"><span>Normal</span><span>{!hasRecordedData ? "--" : device.normal_count}</span></div>
              <div className="dd-count-item"><span>Low</span><span className="low-text">{!hasRecordedData ? "--" : device.low_count}</span></div>
              <div className="dd-count-item"><span>Total</span><span>{!hasRecordedData ? "--" : device.total_count}</span></div>
            </div>
          </div>
        </div>

        <div className="device-storage-summary">
          <div>
            <div className="settings-title-line">
              <strong>Local SD Card</strong>
              <InfoTooltip label="Capacity and usage will be reported by the Raspberry Pi backend. The current values are frontend prototype data until device integration is connected." />
            </div>
            <span>{storageStatus.usedGb} GB used of {storageStatus.capacityGb} GB · {storageStatus.availableGb} GB available</span>
          </div>
          <button type="button" className="text-action-button" onClick={() => navigate(`/devices/${device.device_id}/storage`)}>Manage storage →</button>
        </div>

        <p className="last-updated">{isHistorical ? "Recorded" : "Updated"} {device.last_updated}</p>
        <DetectionHistory deviceId={device.device_id} />
      </main>
    </div>
  );
}

export default DeviceDetail;
