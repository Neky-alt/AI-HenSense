import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import AppHeader from "../components/AppHeader";
import Icon from "../components/Icon";
import InfoTooltip from "../components/InfoTooltip";
import {
  getAlertNotificationSettings,
  updateAlertNotificationSettings,
} from "../services/settingsService";
import {
  DEFAULT_ALERT_NOTIFICATION_SETTINGS,
  type AlertNotificationSettings,
} from "../types/settings";

const alertOptions: Array<{
  key: keyof Pick<AlertNotificationSettings, "lowProductionWarningEnabled" | "deviceOfflineEnabled" | "detectionFailedEnabled" | "staleDataEnabled">;
  title: string;
  description: string;
  tooltip: string;
}> = [
  {
    key: "lowProductionWarningEnabled",
    title: "Low Production",
    description: "Notify the user when a Cage or Free-range monitoring rule enters Warning.",
    tooltip: "The monitoring rule itself is configured in Cage or Free-range Settings. Turning this notification off does not stop the system from creating Warning status or alert records.",
  },
  {
    key: "deviceOfflineEnabled",
    title: "Device Offline",
    description: "Notify the user when a monitoring device loses its connection.",
    tooltip: "The backend will create this alert automatically when a device goes offline and resolve it after the device reconnects.",
  },
  {
    key: "detectionFailedEnabled",
    title: "Detection Failed",
    description: "Notify the user when an AI detection task cannot complete.",
    tooltip: "Users do not resolve this manually. The backend will resolve the alert after a later successful detection or recovery condition.",
  },
  {
    key: "staleDataEnabled",
    title: "Stale Data",
    description: "Notify the user when a device is online but expected detection data is not arriving.",
    tooltip: "Stale Data is different from Device Offline: the device may still be connected, but it has not produced fresh data within the expected monitoring interval.",
  },
];

export default function AlertSettings() {
  const navigate = useNavigate();
  const location = useLocation();
  const backTarget = (location.state as { from?: string } | null)?.from ?? "/profile";
  const [settings, setSettings] = useState<AlertNotificationSettings>(DEFAULT_ALERT_NOTIFICATION_SETTINGS);
  const [message, setMessage] = useState("");

  useEffect(() => {
    getAlertNotificationSettings().then(setSettings);
  }, []);

  const update = <K extends keyof AlertNotificationSettings>(key: K, value: AlertNotificationSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setMessage("");
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await updateAlertNotificationSettings(settings);
    setMessage("Notification settings saved successfully.");
  };

  return (
    <div className="app">
      <AppHeader />
      <main className="dashboard settings-page">
        <button className="back-button" onClick={() => navigate(backTarget)}>← Back</button>

        <div className="settings-page-heading">
          <div>
            <h1>Alert & Notification Settings</h1>
            <p>Choose which automatically generated system alerts should notify the user.</p>
          </div>
        </div>

        <form className="settings-single-column" onSubmit={handleSave}>
          <section className="settings-panel">
            <div className="settings-panel-heading">
              <span className="settings-hub-icon settings-hub-icon-alert"><Icon name="bell" size={19} /></span>
              <div><h2>Notification Preferences</h2><p>Alert lifecycle stays automatic. These switches control user-facing notifications only.</p></div>
            </div>

            <div className="settings-row">
              <div>
                <div className="settings-title-line">
                  <strong>All Alert Notifications</strong>
                  <InfoTooltip label="Master switch for user-facing alert notifications. Turning it off does not disable monitoring rules, Warning status, or the creation of alert history records." />
                </div>
                <span>Temporarily mute or enable all user-facing alert notifications.</span>
              </div>
              <button type="button" className={settings.notificationsEnabled ? "settings-toggle active" : "settings-toggle"} onClick={() => update("notificationsEnabled", !settings.notificationsEnabled)} aria-pressed={settings.notificationsEnabled}><span /></button>
            </div>

            <div className={settings.notificationsEnabled ? "alert-setting-list" : "alert-setting-list settings-config-disabled"}>
              {alertOptions.map((item) => (
                <div className="settings-row" key={item.key}>
                  <div>
                    <div className="settings-title-line">
                      <strong>{item.title}</strong>
                      <InfoTooltip label={item.tooltip} />
                    </div>
                    <span>{item.description}</span>
                  </div>
                  <button type="button" disabled={!settings.notificationsEnabled} className={settings[item.key] ? "settings-toggle active" : "settings-toggle"} onClick={() => update(item.key, !settings[item.key])} aria-pressed={settings[item.key]}><span /></button>
                </div>
              ))}
            </div>

            <div className="settings-explainer">
              <Icon name="info" size={17} />
              <span>Cage uses Low-production Ratio and Free-range uses Low Count to decide Warning status. Active and Resolved are managed automatically by backend conditions and cannot be set manually by users.</span>
            </div>
          </section>

          <div className="settings-page-actions">
            <div>{message && <div className="profile-success">{message}</div>}</div>
            <button type="submit" className="profile-save-button">Save Changes</button>
          </div>
        </form>
      </main>
    </div>
  );
}
