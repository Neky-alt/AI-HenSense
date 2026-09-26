import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { getActiveAlerts } from "../mocks/alerts";
import AlertRow from "./AlertRow";

export default function AlertsMailbox() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const activeAlerts = getActiveAlerts();

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

            {activeAlerts.length === 0 ? (
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
