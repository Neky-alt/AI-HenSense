import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import AlertRow from "../components/AlertRow";
import Icon from "../components/Icon";
import { loadAlerts } from "../services/detectionService";
import { useBackendData } from "../hooks/useBackendData";
import BackendStatus from "../components/BackendStatus";
import type { AlertStatus } from "../types/alert";

type AlertFilter = "all" | AlertStatus;

export default function Alerts() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<AlertFilter>("all");
  const request = useBackendData(loadAlerts);
  const alerts = request.data ?? [];
  const filteredAlerts = useMemo(
    () => filter === "all" ? alerts : alerts.filter((alert) => alert.alert_status === filter),
    [alerts, filter]
  );
  const filters: Array<{ value: AlertFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "active", label: "Active" },
    { value: "resolved", label: "Resolved" },
  ];

  return (
    <div className="app">
      <AppHeader />
      <main className="dashboard alerts-page">
        <div className="monitoring-page-header alerts-page-header">
          <div><h1>Alerts</h1><p>Review system-generated monitoring alerts. Active and Resolved are managed automatically by system conditions.</p></div>
          <button className="secondary-button settings-entry-button" onClick={() => navigate("/settings/alerts", { state: { from: "/alerts" } })}><Icon name="settings" size={16} /> Notification Settings</button>
        </div>

        <div className="alert-lifecycle-note"><Icon name="info" size={17} /><span>Users do not manually resolve alerts. When the underlying condition recovers, the backend will automatically change the alert from Active to Resolved.</span></div>

        <div className="alert-filter-bar" role="group" aria-label="Alert status filter">
          {filters.map((item) => <button key={item.value} className={filter === item.value ? "alert-filter-button active" : "alert-filter-button"} onClick={() => setFilter(item.value)}>{item.label}</button>)}
        </div>

        <BackendStatus loading={request.loading} error={request.error} retry={request.retry} />
        <section className="alerts alerts-page-list">
          <div className="alerts-section-heading"><div><h2>{filter === "all" ? "All Alerts" : `${filter[0].toUpperCase()}${filter.slice(1)} Alerts`}</h2><p>{filteredAlerts.length} alert{filteredAlerts.length === 1 ? "" : "s"}</p></div></div>
          {filteredAlerts.length === 0 ? <div className="empty-state compact-empty-state"><h3>No alerts found</h3><p>There are no alerts in this category.</p></div> : filteredAlerts.map((alert) => <AlertRow alert={alert} key={alert.alert_id} />)}
        </section>
      </main>
    </div>
  );
}
