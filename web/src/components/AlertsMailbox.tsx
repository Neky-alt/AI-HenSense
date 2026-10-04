import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { loadAlerts } from "../services/detectionService";
import { loadAlertNotificationSettings } from "../services/settingsService";
import { useBackendData } from "../hooks/useBackendData";
import AlertRow from "./AlertRow";

/** Header alerts. Hidden when the user turned off in-app alerts (Alert Settings). */
export default function AlertsMailbox() {
  const preference = useBackendData(loadAlertNotificationSettings);
  // If the preference cannot be read (e.g. cloud mode), keep showing alerts.
  if (preference.loading || preference.data?.inAppEnabled === false) return null;
  return <AlertsMailboxPanel />;
}

function AlertsMailboxPanel() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const request = useBackendData(loadAlerts);
  const activeAlerts = (request.data ?? []).filter((alert) => alert.alert_status === "active");

  return (
    <div className="dd-mailbox">
      <button
        className="dd-mailbox-button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Open active alerts"
        title="Active alerts"
      >
        ✉️
        {activeAlerts.length > 0 && (
          <span className="dd-mailbox-badge">{activeAlerts.length}</span>
        )}
      </button>

      {open && (
        <>
          <div className="dd-mailbox-backdrop" onClick={() => setOpen(false)} />
          <div className="dd-mailbox-dropdown">
            <div className="dd-mailbox-dropdown-header">
              <strong>Active Alerts</strong>
              <button className="dd-mailbox-close" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>

            {request.error ? (
              <p className="dd-empty-note" role="alert">Unable to load alerts. <button className="text-action-button" onClick={request.retry}>Retry</button></p>
            ) : request.loading ? (
              <p className="dd-empty-note" role="status">Loading alerts…</p>
            ) : activeAlerts.length === 0 ? (
              <p className="dd-empty-note">No active alerts.</p>
            ) : (
              activeAlerts.map((alert) => (
                <AlertRow
                  key={alert.alert_id}
                  alert={alert}
                  onNavigate={() => setOpen(false)}
                />
              ))
            )}

            <button
              className="dd-mailbox-view-all"
              onClick={() => {
                setOpen(false);
                navigate("/alerts");
              }}
            >
              View all alerts →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
