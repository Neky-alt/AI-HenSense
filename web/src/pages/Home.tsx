import { userMessage } from '../lib/userMessages';
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { Device, FarmingType } from "../types/device";
import { loadDevices, loadAlerts } from "../services/detectionService";
import { useBackendData } from "../hooks/useBackendData";
import BackendStatus from "../components/BackendStatus";
import AlertRow from "../components/AlertRow";
import AppHeader from "../components/AppHeader";
import SummaryCard from "../components/SummaryCard";
import DevicePreviewCard from "../components/DevicePreviewCard";
import Icon from "../components/Icon";
import { formatRatio } from "../utils/ratio";
import { useAuth } from "../contexts/AuthContext";
import {
  getDashboardPreferences,
  resetDashboardPreferences,
  updateDashboardPreferences,
  type DashboardPreferences,
} from "../services/dashboardPreferenceService";
import heroHens from "../assets/mock/hero-hens.jpg";

const MAX_PINNED_PER_TYPE = 2;

const EMPTY_PREFERENCES: DashboardPreferences = {
  cage_device_ids: [],
  free_range_device_ids: [],
};

function getDefaultPreferenceIds(devices: Device[]): DashboardPreferences {
  return {
    cage_device_ids: devices
      .filter((device) => device.farming_type === "caged")
      .slice(0, MAX_PINNED_PER_TYPE)
      .map((device) => device.device_id),
    free_range_device_ids: devices
      .filter((device) => device.farming_type === "free_range")
      .slice(0, MAX_PINNED_PER_TYPE)
      .map((device) => device.device_id),
  };
}

function resolveSelectedDevices(devices: Device[], selectedIds: string[]): Device[] {
  const deviceMap = new Map(devices.map((device) => [device.device_id, device]));
  return selectedIds
    .map((deviceId) => deviceMap.get(deviceId))
    .filter((device): device is Device => Boolean(device));
}

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const request = useBackendData(loadDevices);
  const deviceList = useMemo(() => request.data ?? [], [request.data]);
  const [dashboardPreferences, setDashboardPreferences] = useState<DashboardPreferences | null>(null);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  const [draftPreferences, setDraftPreferences] = useState<DashboardPreferences>(EMPTY_PREFERENCES);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [preferenceError, setPreferenceError] = useState("");

  const alertsState = useBackendData(loadAlerts);
  const alerts = (alertsState.data ?? []).slice(0, 4);



  useEffect(() => {
    let active = true;
    const loadPreferences = async () => {
      if (!user?.id) {
        if (active) {
          setDashboardPreferences(null);
          setPreferencesLoaded(true);
        }
        return;
      }
      setPreferencesLoaded(false);
      const savedPreferences = await getDashboardPreferences(user.id);
      if (active) {
        setDashboardPreferences(savedPreferences);
        setPreferencesLoaded(true);
      }
    };
    loadPreferences();
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    if (!isCustomizeOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsCustomizeOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCustomizeOpen]);

  const cageDevices = useMemo(
    () => deviceList.filter((device) => device.farming_type === "caged"),
    [deviceList]
  );
  const freeRangeDevices = useMemo(
    () => deviceList.filter((device) => device.farming_type === "free_range"),
    [deviceList]
  );

  const cageSummary = useMemo(() => {
    const normal = cageDevices.filter(
      (device) => device.device_status !== "offline" && device.monitoring_status === "normal"
    ).length;
    const warning = cageDevices.filter(
      (device) => device.device_status !== "offline" && device.monitoring_status === "warning"
    ).length;
    const offline = cageDevices.filter((device) => device.device_status === "offline").length;
    const validResults = cageDevices.filter(
      (device) => device.device_status === "online" && device.total_count > 0
    );
    const totalLow = validResults.reduce((sum, device) => sum + device.low_count, 0);
    const totalDetected = validResults.reduce((sum, device) => sum + device.total_count, 0);
    const overallLowRatio = totalDetected > 0 ? totalLow / totalDetected : null;
    return { total: cageDevices.length, normal, warning, offline, overallLowRatio };
  }, [cageDevices]);

  const freeRangeSummary = useMemo(() => {
    const normal = freeRangeDevices.filter(
      (device) => device.device_status !== "offline" && device.monitoring_status === "normal"
    ).length;
    const warning = freeRangeDevices.filter(
      (device) => device.device_status !== "offline" && device.monitoring_status === "warning"
    ).length;
    const offline = freeRangeDevices.filter((device) => device.device_status === "offline").length;
    const latestLowCount = freeRangeDevices
      .filter((device) => device.total_count > 0)
      .reduce((sum, device) => sum + device.low_count, 0);
    return { total: freeRangeDevices.length, normal, warning, offline, latestLowCount };
  }, [freeRangeDevices]);

  const effectivePreferences = useMemo(
    () => dashboardPreferences ?? getDefaultPreferenceIds(deviceList),
    [dashboardPreferences, deviceList]
  );
  const cagePreviewDevices = useMemo(
    () => resolveSelectedDevices(cageDevices, effectivePreferences.cage_device_ids),
    [cageDevices, effectivePreferences.cage_device_ids]
  );
  const freeRangePreviewDevices = useMemo(
    () => resolveSelectedDevices(freeRangeDevices, effectivePreferences.free_range_device_ids),
    [freeRangeDevices, effectivePreferences.free_range_device_ids]
  );

  const currentDate = new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());

  const openCustomize = () => {
    setPreferenceError("");
    setDraftPreferences({
      cage_device_ids: [...effectivePreferences.cage_device_ids],
      free_range_device_ids: [...effectivePreferences.free_range_device_ids],
    });
    setIsCustomizeOpen(true);
  };

  const toggleDraftDevice = (device: Device) => {
    const key = device.farming_type === "caged" ? "cage_device_ids" : "free_range_device_ids";
    setPreferenceError("");
    setDraftPreferences((current) => {
      const selectedIds = current[key];
      if (selectedIds.includes(device.device_id)) {
        return { ...current, [key]: selectedIds.filter((id) => id !== device.device_id) };
      }
      if (selectedIds.length >= MAX_PINNED_PER_TYPE) return current;
      return { ...current, [key]: [...selectedIds, device.device_id] };
    });
  };

  const isDraftDeviceDisabled = (device: Device) => {
    const selectedIds = device.farming_type === "caged"
      ? draftPreferences.cage_device_ids
      : draftPreferences.free_range_device_ids;
    return !selectedIds.includes(device.device_id) && selectedIds.length >= MAX_PINNED_PER_TYPE;
  };

  const savePreferences = async () => {
    if (!user?.id) {
      setPreferenceError("Unable to save dashboard preferences for the current user.");
      return;
    }
    setPreferenceSaving(true);
    setPreferenceError("");
    try {
      const saved = await updateDashboardPreferences(user.id, draftPreferences);
      setDashboardPreferences(saved);
      setIsCustomizeOpen(false);
    } catch (error) {
      setPreferenceError(userMessage(error, "Unable to save dashboard preferences."));
    } finally {
      setPreferenceSaving(false);
    }
  };

  const restoreDefaults = async () => {
    if (!user?.id) return;
    setPreferenceSaving(true);
    setPreferenceError("");
    try {
      await resetDashboardPreferences(user.id);
      const defaults = getDefaultPreferenceIds(deviceList);
      setDashboardPreferences(null);
      setDraftPreferences(defaults);
    } finally {
      setPreferenceSaving(false);
    }
  };

  const renderDevicePickerSection = (
    title: string,
    description: string,
    farmingType: FarmingType,
    devices: Device[]
  ) => {
    const selectedIds = farmingType === "caged"
      ? draftPreferences.cage_device_ids
      : draftPreferences.free_range_device_ids;

    return (
      <section className="quick-monitor-picker-section">
        <div className="quick-monitor-picker-heading">
          <div className="quick-monitor-picker-title">
            <span className={`section-icon ${farmingType === "caged" ? "section-icon-cage" : "section-icon-free-range"}`}>
              <Icon name={farmingType === "caged" ? "cage" : "leaf"} size={17} />
            </span>
            <div><h3>{title}</h3><p>{description}</p></div>
          </div>
          <span className="quick-monitor-count">{selectedIds.length}/{MAX_PINNED_PER_TYPE} selected</span>
        </div>

        <div className="quick-monitor-device-list">
          {devices.length > 0 ? devices.map((device) => {
            const isSelected = selectedIds.includes(device.device_id);
            return (
              <button
                type="button"
                key={device.device_id}
                className={`quick-monitor-device-option${isSelected ? " selected" : ""}`}
                onClick={() => toggleDraftDevice(device)}
                disabled={isDraftDeviceDisabled(device)}
                aria-pressed={isSelected}
              >
                <span className="quick-monitor-checkbox" aria-hidden="true">{isSelected ? "✓" : ""}</span>
                <span className="quick-monitor-option-copy"><strong>{device.device_name}</strong><small>{device.device_code}</small></span>
                <span className={`quick-monitor-option-status connection-${device.device_status}`}>
                  <span className="connection-dot" />
                  {device.device_status === "online" ? "Online" : device.device_status === "offline" ? "Offline" : "Error"}
                </span>
              </button>
            );
          }) : <div className="quick-monitor-picker-empty">No devices available.</div>}
        </div>
      </section>
    );
  };

  if (request.loading || request.error) return <div className="app"><AppHeader /><main className="dashboard home-dashboard"><BackendStatus {...request} /></main></div>;

  return (
    <div className="app">
      <AppHeader />
      {import.meta.env.VITE_DATA_SOURCE === "cloud" && <p className="dd-confidence-note" role="status" style={{ margin: "8px 24px" }}>Cloud snapshot · last synced results only. Offline devices can still show their last recorded detection.</p>}
      <main className="dashboard home-dashboard">
        <section className="welcome welcome-modern">
          <div className="welcome-copy">
            <span className="welcome-sun" aria-hidden="true">☀</span>
            <div><h1>Good morning!</h1><p>Here is the latest overview of your poultry monitoring system.</p></div>
          </div>
          <div className="welcome-meta"><span>{currentDate}</span><small>Last updated: just now</small></div>
        </section>

        <section className="scenario-summary-block">
          <div className="scenario-summary-heading">
            <div><h2>Cage Monitoring Summary</h2><p>Fixed-cage metrics use the latest valid detection from each online cage.</p></div>
            <button className="text-action" onClick={() => navigate("/cages")}>View Cage Monitoring <Icon name="chevron" size={15} /></button>
          </div>
          <div className="summary-grid summary-grid-modern">
            <SummaryCard title="Cage Devices" value={cageSummary.total} tooltip="Number of registered caged monitoring devices." icon="device" onClick={() => navigate("/cages")} />
            <SummaryCard title="Overall Low-production Ratio" value={formatRatio(cageSummary.overallLowRatio)} tooltip="Weighted ratio: total Low count divided by total detected count across the latest valid detection from each online cage." description="Latest valid cage results" valueClassName="highlight-number" icon="chart" tone="highlight" onClick={() => navigate("/cages?sort=low-desc")} />
            <SummaryCard title="Normal" value={cageSummary.normal} tooltip="Number of connected cage devices currently in Normal monitoring status." description="Monitoring status" icon="info" tone="normal" onClick={() => navigate("/cages?status=normal")} />
            <SummaryCard title="Warning" value={cageSummary.warning} tooltip="Cages currently in Warning status. The backend will trigger this after two consecutive results meet the configured low-production threshold." description="Needs review" icon="warning" tone="warning" onClick={() => navigate("/cages?status=warning")} />
            <SummaryCard title="Offline" value={cageSummary.offline} tooltip="Cage devices currently marked as offline. Connectivity is separate from monitoring status." description="Connection status" icon="device" tone="offline" onClick={() => navigate("/cages?status=offline")} />
          </div>
        </section>

        <section className="scenario-summary-block scenario-summary-free-range">
          <div className="scenario-summary-heading">
            <div><h2>Free-range Monitoring Summary</h2><p>Free-range metrics describe latest snapshots rather than the whole moving flock.</p></div>
            <button className="text-action" onClick={() => navigate("/free-range")}>View Free-range Monitoring <Icon name="chevron" size={15} /></button>
          </div>
          <div className="summary-grid summary-grid-modern">
            <SummaryCard title="Free-range Devices" value={freeRangeSummary.total} tooltip="Number of registered free-range monitoring sources." icon="device" onClick={() => navigate("/free-range")} />
            <SummaryCard title="Latest Low Count" value={freeRangeSummary.latestLowCount} tooltip="Sum of Low classifications from the latest valid snapshot of each free-range source. This is not an overall flock ratio." description="Latest snapshots only" valueClassName="highlight-number" icon="chart" tone="highlight" onClick={() => navigate("/free-range?status=all")} />
            <SummaryCard title="Normal" value={freeRangeSummary.normal} tooltip="Number of connected free-range devices currently in Normal monitoring status." description="Monitoring status" icon="info" tone="normal" onClick={() => navigate("/free-range?status=normal")} />
            <SummaryCard title="Warning" value={freeRangeSummary.warning} tooltip="Free-range sources currently in Warning status. The planned backend rule uses Low Count for two consecutive snapshots." description="Needs review" icon="warning" tone="warning" onClick={() => navigate("/free-range?status=warning")} />
            <SummaryCard title="Offline" value={freeRangeSummary.offline} tooltip="Free-range devices currently marked as offline." description="Connection status" icon="device" tone="offline" onClick={() => navigate("/free-range?status=offline")} />
          </div>
        </section>

        <section className="home-mid-grid">
          <div className="alerts home-alerts-panel">
            <div className="alerts-header enhanced-alerts-header">
              <div className="section-heading-with-icon">
                <span className="section-icon section-icon-alert"><Icon name="bell" size={20} /></span>
                <div><h2>Recent Alerts</h2><p>System-generated alerts are resolved automatically when the underlying condition recovers.</p></div>
              </div>
              <button className="see-all-button" onClick={() => navigate("/alerts")}>View all alerts <Icon name="chevron" size={16} /></button>
            </div>
            <BackendStatus loading={alertsState.loading} error={alertsState.error} retry={alertsState.retry} />
            <div className="home-alert-list">{alerts.map((alert) => <AlertRow alert={alert} key={alert.alert_id} />)}</div>
          </div>

          <div className="home-hero-card" aria-label="Poultry monitoring mission banner">
            <img src={heroHens} alt="Free-range hens in a farm setting" />
            <span className="home-hero-overlay" />
            <div className="home-hero-copy"><span className="hero-kicker">Our Mission</span><h2>Healthy Poultry<br />Brighter Tomorrow</h2><p>Monitor. Understand. Improve.</p></div>
          </div>
        </section>

        <section className="home-device-section quick-monitoring-section">
          <div className="home-section-heading quick-monitoring-heading">
            <div className="section-heading-with-icon"><span className="section-icon"><Icon name="device" size={20} /></span><div><h2>Quick Monitoring</h2><p>Monitor the devices that matter most.</p></div></div>
            <button type="button" className="quick-monitor-customize-button" onClick={openCustomize} disabled={!preferencesLoaded}><Icon name="settings" size={16} />Customize</button>
          </div>

          <div className="monitoring-preview-group monitoring-preview-group-cage">
            <div className="monitoring-preview-heading">
              <div className="monitoring-preview-label"><div className="section-heading-with-icon compact-heading"><span className="section-icon section-icon-cage"><Icon name="cage" size={18} /></span><div><h3>Cage Monitoring</h3><p>Your selected caged monitoring devices.</p></div></div></div>
              <button className="text-action" onClick={() => navigate("/cages")}>View all <Icon name="chevron" size={15} /></button>
            </div>
            {cagePreviewDevices.length > 0 ? <div className="device-preview-grid">{cagePreviewDevices.map((device) => <DevicePreviewCard key={device.device_id} device={device} />)}</div> : <div className="home-preview-empty">No cage devices selected. Use Customize to add devices to Quick Monitoring.</div>}
          </div>

          <div className="monitoring-preview-group monitoring-preview-group-free-range">
            <div className="monitoring-preview-heading">
              <div className="monitoring-preview-label"><div className="section-heading-with-icon compact-heading"><span className="section-icon section-icon-free-range"><Icon name="leaf" size={18} /></span><div><h3>Free-range Monitoring</h3><p>Your selected free-range monitoring devices.</p></div></div></div>
              <button className="text-action" onClick={() => navigate("/free-range")}>View all <Icon name="chevron" size={15} /></button>
            </div>
            {freeRangePreviewDevices.length > 0 ? <div className="device-preview-grid">{freeRangePreviewDevices.map((device) => <DevicePreviewCard key={device.device_id} device={device} />)}</div> : <div className="home-preview-empty">No free-range devices selected. Use Customize to add devices to Quick Monitoring.</div>}
          </div>
        </section>
      </main>

      {isCustomizeOpen && (
        <div className="quick-monitor-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsCustomizeOpen(false); }}>
          <div className="quick-monitor-modal" role="dialog" aria-modal="true" aria-labelledby="quick-monitor-modal-title">
            <div className="quick-monitor-modal-header">
              <div><span className="profile-card-kicker">DASHBOARD</span><h2 id="quick-monitor-modal-title">Customize Quick Monitoring</h2><p>Choose up to {MAX_PINNED_PER_TYPE} devices from each farming type.</p></div>
              <button type="button" className="quick-monitor-modal-close" onClick={() => setIsCustomizeOpen(false)} aria-label="Close customize dialog">×</button>
            </div>
            <div className="quick-monitor-modal-body">
              {renderDevicePickerSection("Cage Monitoring", "Choose the caged devices you check most often.", "caged", cageDevices)}
              {renderDevicePickerSection("Free-range Monitoring", "Choose the free-range devices you check most often.", "free_range", freeRangeDevices)}
            </div>
            {preferenceError && <div className="quick-monitor-modal-error">{preferenceError}</div>}
            <div className="quick-monitor-modal-footer">
              <button type="button" className="quick-monitor-reset-button" onClick={restoreDefaults} disabled={preferenceSaving}>Use defaults</button>
              <div className="quick-monitor-modal-actions"><button type="button" className="quick-monitor-cancel-button" onClick={() => setIsCustomizeOpen(false)} disabled={preferenceSaving}>Cancel</button><button type="button" className="quick-monitor-save-button" onClick={savePreferences} disabled={preferenceSaving}>{preferenceSaving ? "Saving..." : "Save selection"}</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
