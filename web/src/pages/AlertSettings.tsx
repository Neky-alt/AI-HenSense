import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import AppHeader from "../components/AppHeader";
import BackendStatus from "../components/BackendStatus";
import Icon from "../components/Icon";
import InfoTooltip from "../components/InfoTooltip";
import { useBackendData } from "../hooks/useBackendData";
import { userMessage } from "../lib/userMessages";
import { LOCAL_BACKEND_WRITES } from "../services/apiClient";
import {
  loadAlertNotificationSettings,
  updateAlertNotificationSettings,
} from "../services/settingsService";
import type { AlertNotificationSettings } from "../types/settings";

export default function AlertSettings() {
  const navigate = useNavigate();
  const location = useLocation();
  const backTarget = (location.state as { from?: string } | null)?.from ?? "/profile";
  const request = useBackendData(loadAlertNotificationSettings);

  return (
    <div className="app">
      <AppHeader />
      <main className="dashboard settings-page">
        <button className="back-button" onClick={() => navigate(backTarget)}>← Back</button>

        <div className="settings-page-heading">
          <div>
            <h1>Alert Settings</h1>
            <p>Choose whether active system alerts are shown in the app header.</p>
          </div>
        </div>

        {request.data ? <AlertSettingsForm initial={request.data} /> : <BackendStatus {...request} />}
      </main>
    </div>
  );
}

function AlertSettingsForm({ initial }: { initial: AlertNotificationSettings }) {
  const [inAppEnabled, setInAppEnabled] = useState(initial.inAppEnabled);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const saved = await updateAlertNotificationSettings({ inAppEnabled });
      setInAppEnabled(saved.inAppEnabled);
      setMessage({ type: "success", text: "Alert settings saved." });
    } catch (err) {
      setMessage({ type: "error", text: userMessage(err, "Settings were not saved. Please try again.") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="settings-single-column" onSubmit={handleSave}>
      <section className="settings-panel">
        <div className="settings-panel-heading">
          <span className="settings-hub-icon settings-hub-icon-alert"><Icon name="bell" size={19} /></span>
          <div><h2>In-app Alerts</h2><p>Alerts are always created and resolved automatically. This switch only controls whether they are shown to you in the header.</p></div>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-title-line">
              <strong>Show alerts in the app</strong>
              <InfoTooltip label="When off, the alert badge and dropdown in the header are hidden. Monitoring rules, Warning status and the Alerts history page are not affected." />
            </div>
            <span>Low production, device offline, detection failed and stale data alerts.</span>
          </div>
          <button
            type="button"
            className={inAppEnabled ? "settings-toggle active" : "settings-toggle"}
            onClick={() => { setInAppEnabled((value) => !value); setMessage(null); }}
            aria-pressed={inAppEnabled}
            aria-label="Show alerts in the app"
            disabled={saving || !LOCAL_BACKEND_WRITES}
          ><span /></button>
        </div>

        <div className="settings-explainer">
          <Icon name="info" size={17} />
          <span>Cage uses Low-production Ratio and Free-range uses Low Count to decide Warning status. Active and Resolved are managed automatically by the Backend.</span>
        </div>
      </section>

      <div className="settings-page-actions">
        <div>
          {message?.type === "success" && <div className="profile-success">{message.text}</div>}
          {message?.type === "error" && <div className="form-error" role="alert">{message.text}</div>}
          {!LOCAL_BACKEND_WRITES && <span className="form-hint">Changing settings requires the local Backend.</span>}
        </div>
        <button type="submit" className="profile-save-button" disabled={saving || !LOCAL_BACKEND_WRITES}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
