import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import type { Device, MonitoringStatus } from "../types/device";
import DeviceCard from "../components/DeviceCard";
import AppHeader from "../components/AppHeader";
import InfoTooltip from "../components/InfoTooltip";
import Icon from "../components/Icon";
import { MONITORING_STATUS_OPTIONS } from "../config/monitoringStatus";
import { loadDevices } from "../services/detectionService";
import { useBackendData } from "../hooks/useBackendData";
import BackendStatus from "../components/BackendStatus";

type Filter = "all" | MonitoringStatus | "offline";
type SortMode = "default" | "low-desc" | "low-asc" | "name-asc" | "name-desc";

const FILTER_OPTIONS: Array<{
  value: Filter;
  label: string;
  tone: "all" | "normal" | "warning" | "offline";
}> = [
  { value: "all", label: "All", tone: "all" },
  ...MONITORING_STATUS_OPTIONS,
  { value: "offline", label: "Offline", tone: "offline" },
];

function isFilter(value: string | null): value is Filter {
  return value === "all" || value === "normal" || value === "warning" || value === "offline";
}

function isSortMode(value: string | null): value is SortMode {
  return value === "default" || value === "low-desc" || value === "low-asc" || value === "name-asc" || value === "name-desc";
}

export default function CageMonitoring() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStatus = searchParams.get("status");
  const filter: Filter = isFilter(initialStatus) ? initialStatus : "all";
  const sortParam = searchParams.get("sort");
  const sortMode: SortMode = isSortMode(sortParam) ? sortParam : "default";
  const request = useBackendData(loadDevices);
  const deviceList = useMemo(() => request.data ?? [], [request.data]);
  const [deviceToDelete, setDeviceToDelete] = useState<Device | null>(null);
  const [showDeleteSuccess, setShowDeleteSuccess] = useState(false);

  const cageDevices = useMemo(() => {
    const filtered = deviceList.filter((device) => {
      if (device.farming_type !== "caged") return false;
      if (filter === "all") return true;
      if (filter === "offline") return device.device_status === "offline";
      return device.device_status !== "offline" && device.monitoring_status === filter;
    });

    const sorted = [...filtered];
    if (sortMode === "low-desc") {
      return sorted.sort((a, b) => (b.low_ratio ?? -1) - (a.low_ratio ?? -1));
    }
    if (sortMode === "low-asc") {
      return sorted.sort((a, b) => {
        if (a.low_ratio == null) return 1;
        if (b.low_ratio == null) return -1;
        return a.low_ratio - b.low_ratio;
      });
    }
    if (sortMode === "name-asc") {
      return sorted.sort((a, b) => a.device_name.localeCompare(b.device_name));
    }
    if (sortMode === "name-desc") {
      return sorted.sort((a, b) => b.device_name.localeCompare(a.device_name));
    }
    return filtered;
  }, [deviceList, filter, sortMode]);

  const setFilter = (value: Filter) => {
    const next = new URLSearchParams(searchParams);
    if (value === "all") next.delete("status");
    else next.set("status", value);
    setSearchParams(next);
  };

  const setSortMode = (value: SortMode) => {
    const next = new URLSearchParams(searchParams);
    if (value === "default") next.delete("sort");
    else next.set("sort", value);
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
              <h1>Cage Monitoring</h1>
              <InfoTooltip label="Normal and Low are AI classifications. Monitoring Status is only Normal or Warning. Cage Warning is based on the configurable low-production ratio threshold and will be confirmed by two consecutive detections in the backend." />
            </div>
            <p>Monitor the latest fixed-cage detection result for each device.</p>
          </div>

          <div className="page-header-actions">
            <span className="device-total">{cageDevices.length} devices</span>
            <button className="secondary-button settings-entry-button" onClick={() => navigate("/settings/cage", { state: { from: "/cages" } })}>
              <Icon name="settings" size={16} /> Settings
            </button>
            <button className="add-device-button" disabled onClick={() => navigate("/devices/add")} title="Device registration is not connected to the Backend" aria-label="Add Device">+</button>
          </div>
        </div>

        <div className="monitoring-controls monitoring-controls-filter-only">
          <div className="filter-bar" role="group" aria-label="Monitoring status filter">
            {FILTER_OPTIONS.map((item) => (
              <button key={item.value} className={`filter-button filter-${item.tone}${filter === item.value ? " active" : ""}`} onClick={() => setFilter(item.value)}>
                {item.value !== "all" && <span className={`filter-dot filter-dot-${item.tone}`} aria-hidden="true" />}
                {item.label}
              </button>
            ))}
          </div>

          <label className="monitoring-sort-control">
            <span>Sort</span>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label="Sort cage devices">
              <option value="default">Default order</option>
              <option value="low-desc">Low-production ratio: high to low</option>
              <option value="low-asc">Low-production ratio: low to high</option>
              <option value="name-asc">Device name: A to Z</option>
              <option value="name-desc">Device name: Z to A</option>
            </select>
          </label>
        </div>

        <BackendStatus {...request} />
        <section className="device-grid">
          {cageDevices.map((device) => <DeviceCard key={device.device_id} device={device} onDelete={(selected) => setDeviceToDelete(selected)} />)}
        </section>

        {!request.loading && !request.error && cageDevices.length === 0 && <div className="empty-state"><h3>No devices found</h3><p>No accessible devices match this view. Your account may not have a farm yet.</p></div>}
      </main>

      {deviceToDelete && (
        <div className="modal-overlay"><div className="system-modal" role="dialog" aria-modal="true"><div className="delete-icon">!</div><h2>Delete Device?</h2><p>Are you sure you want to delete this device?</p><div className="modal-device-info"><span>Device</span><strong>{deviceToDelete.device_name}</strong><small>{deviceToDelete.device_code}</small></div><div className="delete-modal-actions"><button className="secondary-button" onClick={() => setDeviceToDelete(null)}>Cancel</button><button className="danger-button" onClick={confirmDelete}>Delete Device</button></div></div></div>
      )}

      {showDeleteSuccess && (
        <div className="modal-overlay"><div className="system-modal" role="dialog" aria-modal="true"><div className="success-icon">✓</div><h2>Device Deleted</h2><p>The device has been deleted successfully.</p><button className="modal-confirm-button" onClick={() => setShowDeleteSuccess(false)}>Done</button></div></div>
      )}
    </div>
  );
}
