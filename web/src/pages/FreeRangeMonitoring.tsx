import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import type { Device, MonitoringStatus } from "../types/device";
import { loadDevices, loadFreeRangeResults } from "../services/detectionService";
import { useBackendData } from "../hooks/useBackendData";
import BackendStatus from "../components/BackendStatus";
import StatusBadge from "../components/StatusBadge";
import DeviceConnectionStatus from "../components/DeviceConnectionStatus";
import AppHeader from "../components/AppHeader";
import InfoTooltip from "../components/InfoTooltip";
import Icon from "../components/Icon";
import { formatRatio } from "../utils/ratio";
import DetectionImage from "../components/DetectionImage";
import LatestManualDetection from "../components/LatestManualDetection";

type Filter = "all" | MonitoringStatus | "offline";

const FILTERS: Array<{ value: Filter; label: string; tone: "all" | "normal" | "warning" | "offline" }> = [
  { value: "all", label: "All", tone: "all" },
  { value: "normal", label: "Normal", tone: "normal" },
  { value: "warning", label: "Warning", tone: "warning" },
  { value: "offline", label: "Offline", tone: "offline" },
];

function isFilter(value: string | null): value is Filter {
  return value === "all" || value === "normal" || value === "warning" || value === "offline";
}


export default function FreeRangeMonitoring() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const request = useBackendData(loadDevices);
  const deviceList = request.data ?? [];
  const filter: Filter = isFilter(searchParams.get("status")) ? (searchParams.get("status") as Filter) : "all";
  const allFreeRangeDevices = deviceList.filter((device) => device.farming_type === "free_range");
  const filteredFreeRangeDevices = useMemo(() => {
    const result = allFreeRangeDevices.filter((device) => {
      if (filter === "all") return true;
      if (filter === "offline") return device.device_status === "offline";
      return device.device_status !== "offline" && device.monitoring_status === filter;
    });
    return result;
  }, [allFreeRangeDevices, filter]);

  const [selectedDeviceId, setSelectedDeviceId] = useState(filteredFreeRangeDevices[0]?.device_id ?? allFreeRangeDevices[0]?.device_id ?? "");
  const [deviceToDelete, setDeviceToDelete] = useState<Device | null>(null);
  const [showDeleteSuccess, setShowDeleteSuccess] = useState(false);

  const camera = filteredFreeRangeDevices.find((device) => device.device_id === selectedDeviceId) ?? filteredFreeRangeDevices[0];
  const results = useBackendData(loadFreeRangeResults, camera?.device_id ?? "");
  const snapshot = results.data?.formal;
  const hasDetectionData = !!snapshot;
  const snapshotTime = snapshot ? new Date(snapshot.detected_at).toLocaleString() : "—";

  const setFilter = (value: Filter) => {
    const next = new URLSearchParams(searchParams);
    next.delete("sort");
    if (value === "all") next.delete("status"); else next.set("status", value);
    setSearchParams(next);
  };


  const confirmDelete = () => {
    if (!deviceToDelete) return;
    // No Backend deletion endpoint exists in this read-only integration.
    setDeviceToDelete(null);
  };

  return (
    <div className="app">
      <AppHeader />
      <main className="dashboard monitoring-page">
        <div className="monitoring-page-header">
          <div>
            <div className="page-title-row">
              <h1>Free-range Monitoring</h1>
              <InfoTooltip label="Free-range birds move continuously, so snapshot ratios describe only the current image. Warning status uses a configurable Low Count threshold for two consecutive result snapshots rather than an overall flock ratio." />
            </div>
            <p>View the latest result snapshot from each free-range monitoring source.</p>
          </div>

          <div className="page-header-actions">
            <span className="device-total">{allFreeRangeDevices.length} devices</span>
            <button className="secondary-button settings-entry-button" onClick={() => navigate("/settings/free-range", { state: { from: "/free-range" } })}><Icon name="settings" size={16} /> Settings</button>
            <button className="add-device-button" disabled onClick={() => navigate("/devices/add")} title="Device registration is not connected to the Backend" aria-label="Add Device">+</button>
          </div>
        </div>

        <div className="monitoring-controls free-range-filter-controls">
          <div className="filter-bar" role="group" aria-label="Free-range status filter">
            {FILTERS.map((item) => (
              <button key={item.value} className={`filter-button filter-${item.tone}${filter === item.value ? " active" : ""}`} onClick={() => setFilter(item.value)}>
                {item.value !== "all" && <span className={`filter-dot filter-dot-${item.tone}`} />}
                {item.label}
              </button>
            ))}
          </div>

        </div>

        <BackendStatus {...request} />
        {!request.loading && !request.error && (filteredFreeRangeDevices.length === 0 ? (
          <div className="empty-state"><h3>No matching free-range devices</h3><p>No accessible devices match this view. Your account may not have a farm yet.</p></div>
        ) : camera ? (
          <>
            <div className="free-range-device-selector">
              <label htmlFor="free-range-camera">Monitoring Device</label>
              <select id="free-range-camera" value={camera.device_id} onChange={(event) => setSelectedDeviceId(event.target.value)}>
                {filteredFreeRangeDevices.map((device) => <option key={device.device_id} value={device.device_id}>{device.device_name} ({device.device_code})</option>)}
              </select>
            </div>

            <BackendStatus {...results} />
            {!results.loading && !results.error && <>
            <div className="free-range-layout">
              <section className="free-range-camera-card">
                <div className="free-range-card-header">
                  <div><h2>{camera.device_name}</h2><span className="device-code">{camera.device_code}</span></div>
                  <div className="device-card-actions">
                    <button className="edit-device-button" disabled title="Device editing is not connected to the Backend" onClick={() => navigate(`/devices/${camera.device_id}/edit`)}>Edit</button>
                    <button className="delete-device-button" disabled title="Device deletion is not available in the Backend API" onClick={() => setDeviceToDelete(camera)}>Delete</button>
                    <DeviceConnectionStatus status={camera.device_status} />
                  </div>
                </div>

                <div className="free-range-image-wrapper">
                  <DetectionImage className="free-range-image" src={snapshot?.annotated_image_url || snapshot?.screenshot_url || ""} fallbackSrc={snapshot?.screenshot_url} alt={camera.device_name} />

                </div>

                <div className="free-range-update"><span>{camera.device_status !== "online" && hasDetectionData ? "Last Recorded Result" : "Latest Formal Snapshot"} · {snapshotTime}</span><button className="details-button" onClick={() => navigate(`/devices/${camera.device_id}`)}>View Details →</button></div>
              </section>

              <section className="free-range-summary-card">
                <div className="metric-heading-row"><h2>{camera.device_status !== "online" && hasDetectionData ? "Last Recorded Result" : "Latest Snapshot Summary"}</h2><InfoTooltip label="Normal Ratio and Low-production Ratio describe this snapshot only. They do not estimate the overall free-range flock ratio." /></div>

                {hasDetectionData ? (
                  <>
                    <div className="free-range-count-grid">
                      <div><span>Normal</span><strong className="normal-text">{snapshot.normal_count}</strong></div>
                      <div><span>Low</span><strong className="low-text">{snapshot.low_count}</strong></div>
                      <div><span>Total Detected</span><strong>{snapshot.total_count}</strong></div>
                    </div>

                    <div className="dual-ratio-grid free-range-dual-ratio">
                      <div className="ratio-stat ratio-stat-normal"><span>Normal Ratio</span><strong>{formatRatio(snapshot.normal_ratio)}</strong><div className="ratio-bar"><div className="ratio-bar-fill" style={{ width: `${(snapshot.normal_ratio ?? 0) * 100}%` }} /></div></div>
                      <div className="ratio-stat ratio-stat-low"><span>Current Snapshot Low Ratio</span><strong>{formatRatio(snapshot.low_ratio)}</strong><div className="ratio-bar low-ratio-bar"><div className="ratio-bar-fill" style={{ width: `${(snapshot.low_ratio ?? 0) * 100}%` }} /></div></div>
                    </div>

                    <div className="monitoring-status-line"><span>{camera.device_status !== "online" ? "Recorded Monitoring Status" : "Monitoring Status"}</span><StatusBadge status={snapshot.monitoring_status} /></div>
                    <div className="snapshot-rule-note"><Icon name="info" size={15} /><span>This is a formal Result Snapshot. Manual detections are available in Detection History. Warning uses Low Count across consecutive snapshots, not this ratio alone.</span></div>

                    {camera.recent_chicken && (
                      <div className="recent-chicken-summary"><span>Most Recent Chicken</span><strong className={camera.recent_chicken.classification === "normal" ? "normal-text" : "low-text"}>{camera.recent_chicken.classification === "normal" ? "Normal" : "Low"}</strong><small>Confidence {camera.recent_chicken.confidence}%</small></div>
                    )}
                  </>
                ) : <div className="empty-state compact-empty-state"><h3>No current data</h3><p>This device has no formal Result Snapshot. Manual detections, if available, remain in Detection History.</p></div>}
              </section>
            </div>
            {!snapshot && results.data?.manual && <LatestManualDetection device={camera} detection={results.data.manual} />}
            </>}
          </>
        ) : (
          <div className="empty-state"><h3>No free-range monitoring devices</h3><p>No accessible devices match this view. Your account may not have a farm yet.</p></div>
        ))}
      </main>

      {deviceToDelete && <div className="modal-overlay"><div className="system-modal" role="dialog" aria-modal="true"><div className="delete-icon">!</div><h2>Delete Device?</h2><p>Are you sure you want to delete this device?</p><div className="modal-device-info"><span>Device</span><strong>{deviceToDelete.device_name}</strong><small>{deviceToDelete.device_code}</small></div><div className="delete-modal-actions"><button className="secondary-button" onClick={() => setDeviceToDelete(null)}>Cancel</button><button className="danger-button" onClick={confirmDelete}>Delete Device</button></div></div></div>}
      {showDeleteSuccess && <div className="modal-overlay"><div className="system-modal" role="dialog" aria-modal="true"><div className="success-icon">✓</div><h2>Device Deleted</h2><p>The device has been deleted successfully.</p><button className="modal-confirm-button" onClick={() => setShowDeleteSuccess(false)}>Done</button></div></div>}
    </div>
  );
}
