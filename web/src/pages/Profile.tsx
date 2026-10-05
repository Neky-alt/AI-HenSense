import { userMessage } from '../lib/userMessages';
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import AppHeader from "../components/AppHeader";
import Icon from "../components/Icon";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import {
  updateProfileAvatar,
  removeProfileAvatar,
  getRemoteProfile,
  getLegacyAvatarUrl,
  hasLegacyAvatar,
  syncLegacyAvatar,
} from "../services/profileService";
import {
  getAlertNotificationSettings,
  getCageMonitoringSettings,
  getFreeRangeMonitoringSettings,
} from "../services/settingsService";
import type {
  AlertNotificationSettings,
  CageMonitoringSettings,
  FreeRangeMonitoringSettings,
} from "../types/settings";
import { formatRatio } from "../utils/ratio";

export default function Profile() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const initialDisplayName =
    typeof user?.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : user?.email?.split("@")[0] ?? "";

  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
  const [accountError, setAccountError] = useState("");

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [avatarError, setAvatarError] = useState("");

  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  const [cageSettings, setCageSettings] = useState<CageMonitoringSettings | null>(null);
  const [freeRangeSettings, setFreeRangeSettings] = useState<FreeRangeMonitoringSettings | null>(null);
  const [alertSettings, setAlertSettings] = useState<AlertNotificationSettings | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (!user?.id) return;
      try {
        const profile = await getRemoteProfile();
        if (active) {
          setDisplayName(profile.displayName);
          setAvatarUrl(profile.avatarUrl || getLegacyAvatarUrl(user.id));
          setLegacyAvailable(!profile.avatarPath && hasLegacyAvatar(user.id));
          setAvatarError("");
        }
      } catch (error) {
        if (active) setAvatarError(userMessage(error, "Unable to fetch cloud profile."));
      }
    };
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("profile-updated", onFocus);
    return () => { active = false; window.removeEventListener("focus", onFocus); window.removeEventListener("profile-updated", onFocus); };
  }, [user?.id]);

  useEffect(() => {
    let active = true;

    const loadSettings = async () => {
      // Each summary loads independently so one failing request does not hide the others.
      const [cage, freeRange, alerts] = await Promise.allSettled([
        getCageMonitoringSettings(),
        getFreeRangeMonitoringSettings(),
        getAlertNotificationSettings(),
      ]);

      if (active) {
        if (cage.status === "fulfilled") setCageSettings(cage.value);
        if (freeRange.status === "fulfilled") setFreeRangeSettings(freeRange.value);
        if (alerts.status === "fulfilled") setAlertSettings(alerts.value);
      }
    };

    loadSettings();
    return () => {
      active = false;
    };
  }, []);

  const email = user?.email ?? "—";
  const emailConfirmed = Boolean(user?.email_confirmed_at);
  const memberSince = user?.created_at
    ? new Intl.DateTimeFormat("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(user.created_at))
    : "—";
  const avatarInitial = (displayName || email || "A").charAt(0).toUpperCase();

  const handleAccountSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = displayName.trim();
    setAccountMessage("");
    setAccountError("");

    if (!trimmedName) {
      setAccountError("Display name cannot be empty.");
      return;
    }

    setAccountSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { display_name: trimmedName },
      });
      if (error) throw error;
      setDisplayName(trimmedName);
      setAccountMessage("Account information updated successfully.");
    } catch (error) {
      setAccountError(
        userMessage(error, "Unable to update account information.")
      );
    } finally {
      setAccountSaving(false);
    }
  };

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user?.id) return;

    setAvatarError("");
    setAvatarSaving(true);
    try {
      const newAvatar = await updateProfileAvatar(user.id, file);
      setAvatarUrl(newAvatar);
      setLegacyAvailable(false);
      window.dispatchEvent(new Event("profile-updated"));
    } catch (error) {
      setAvatarError(userMessage(error, "Unable to update profile photo."));
    } finally {
      setAvatarSaving(false);
      event.target.value = "";
    }
  };

  const handleRemoveAvatar = async () => {
    if (!user?.id) return;
    setAvatarError("");
    try {
      await removeProfileAvatar(user.id);
      setAvatarUrl(null);
      setLegacyAvailable(false);
      window.dispatchEvent(new Event("profile-updated"));
    } catch (error) {
      setAvatarError(userMessage(error, "Unable to remove profile photo."));
    }
  };

  const handleLegacySync = async () => {
    if (!user?.id || avatarSaving) return;
    setAvatarError(""); setAvatarSaving(true);
    try {
      const url = await syncLegacyAvatar(user.id);
      setAvatarUrl(url); setLegacyAvailable(false);
      window.dispatchEvent(new Event("profile-updated"));
    } catch (error) {
      setAvatarError(userMessage(error, "Unable to sync your previous photo."));
    } finally { setAvatarSaving(false); }
  };

  const handleLogout = async () => {
    setLogoutError("");
    setLoggingOut(true);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch (error) {
      setLogoutError(userMessage(error, "Unable to sign out."));
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="app">
      <AppHeader />
      <main className="dashboard profile-page">
        <div className="page-heading-block">
          <h1>Profile & Settings</h1>
          <p>Manage your account and open monitoring settings for each farming scenario.</p>
        </div>

        <div className="profile-grid">
          <section className="profile-section-card">
            <div className="profile-card-heading">
              <div>
                <h2>Account Information</h2>
              </div>
              <span className="account-status"><span className="account-status-dot" />Signed in</span>
            </div>

            <div className="account-profile-summary">
              <div className="account-avatar-wrapper">
                <div className="account-avatar">
                  {avatarUrl ? <img src={avatarUrl} alt={`${displayName} profile`} /> : avatarInitial}
                </div>
                <label className="avatar-edit-button" title="Change profile photo">
                  {avatarSaving ? "…" : "✎"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarChange} disabled={avatarSaving} hidden />
                </label>
              </div>

              <div className="account-profile-copy">
                <strong>{displayName || "Account"}</strong>
                <span>{email}</span>
                <div className="avatar-actions">
                  <label className="avatar-text-action">
                    Change photo
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarChange} disabled={avatarSaving} hidden />
                  </label>
                  {avatarUrl && <button type="button" onClick={handleRemoveAvatar} disabled={avatarSaving}>Remove</button>}
                  {legacyAvailable && <button type="button" onClick={handleLegacySync} disabled={avatarSaving}>Sync old photo to cloud</button>}
                </div>
              </div>
            </div>

            {avatarError && <div className="profile-error">{avatarError}</div>}

            <form className="profile-settings-form" onSubmit={handleAccountSave}>
              <div className="profile-field">
                <label htmlFor="display-name">Display Name</label>
                <input
                  id="display-name"
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  maxLength={60}
                />
              </div>

              <div className="profile-field">
                <label htmlFor="account-email">Email</label>
                <input id="account-email" type="email" value={email} disabled />
                <small>Email changes are not included in the current project scope.</small>
              </div>

              <div className="account-info-list">
                <div className="account-info-row">
                  <span>Email status</span>
                  <strong className={emailConfirmed ? "confirmed-text" : ""}>
                    {emailConfirmed ? "Verified" : "Not verified"}
                  </strong>
                </div>
                <div className="account-info-row">
                  <span>Member since</span>
                  <strong>{memberSince}</strong>
                </div>
              </div>

              {accountError && <div className="profile-error">{accountError}</div>}
              {accountMessage && <div className="profile-success">{accountMessage}</div>}

              <div className="profile-account-actions">
                <button type="submit" className="profile-save-button" disabled={accountSaving}>
                  {accountSaving ? "Saving..." : "Save account"}
                </button>
              </div>
            </form>

            <div className="profile-danger-zone">
              <div>
                <strong>Sign out</strong>
                <span>End your current HenSense session.</span>
              </div>
              <button
                type="button"
                className="profile-logout-button"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                {loggingOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
            {logoutError && <div className="profile-error">{logoutError}</div>}
          </section>

          <section className="profile-section-card settings-hub-card">
            <div className="profile-card-heading">
              <div>
                <h2>Monitoring Settings</h2>
              </div>
            </div>
            <p className="profile-section-description">
              Cage and free-range monitoring now use separate control logic. Open a section to customise its schedule, warning rule and capture behaviour.
            </p>

            <div className="settings-hub-list">
              <button type="button" className="settings-hub-item" onClick={() => navigate("/settings/cage", { state: { from: "/profile" } })}>
                <span className="settings-hub-icon settings-hub-icon-cage"><Icon name="cage" size={20} /></span>
                <span className="settings-hub-copy">
                  <strong>Cage Monitoring Settings</strong>
                  <small>
                    {cageSettings
                      ? `${cageSettings.monitoringEnabled ? "Running" : "Paused"} · Warning at ${formatRatio(cageSettings.lowProductionWarningThreshold)}`
                      : "Loading settings..."}
                  </small>
                </span>
                <Icon name="chevron" size={17} />
              </button>

              <button type="button" className="settings-hub-item" onClick={() => navigate("/settings/free-range", { state: { from: "/profile" } })}>
                <span className="settings-hub-icon settings-hub-icon-free-range"><Icon name="leaf" size={20} /></span>
                <span className="settings-hub-copy">
                  <strong>Free-range Monitoring Settings</strong>
                  <small>
                    {freeRangeSettings
                      ? `${freeRangeSettings.monitoringEnabled ? "Running" : "Paused"} · Low count warning ≥ ${freeRangeSettings.lowCountWarningThreshold}`
                      : "Loading settings..."}
                  </small>
                </span>
                <Icon name="chevron" size={17} />
              </button>

              <button type="button" className="settings-hub-item" onClick={() => navigate("/settings/alerts", { state: { from: "/profile" } })}>
                <span className="settings-hub-icon settings-hub-icon-alert"><Icon name="bell" size={20} /></span>
                <span className="settings-hub-copy">
                  <strong>Alert Settings</strong>
                  <small>
                    {alertSettings
                      ? alertSettings.inAppEnabled ? "In-app alerts on" : "In-app alerts off"
                      : "Loading settings..."}
                  </small>
                </span>
                <Icon name="chevron" size={17} />
              </button>
            </div>

            <div className="settings-hub-note">
              <Icon name="info" size={17} />
              <span>
                These settings are saved to the Backend and apply to every device on your farm.
              </span>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
