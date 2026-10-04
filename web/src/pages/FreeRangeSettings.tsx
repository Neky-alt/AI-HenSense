import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import AppHeader from "../components/AppHeader";
import Icon from "../components/Icon";
import InfoTooltip from "../components/InfoTooltip";
import { userMessage } from "../lib/userMessages";
import {
  getFreeRangeMonitoringSettings,
  updateFreeRangeMonitoringSettings,
} from "../services/settingsService";
import {
  DEFAULT_FREE_RANGE_MONITORING_SETTINGS,
  type FreeRangeMonitoringSettings,
  type FrequencyUnit,
} from "../types/settings";

type FreeFieldError = "snapshotFrequency" | "timeWindow" | "lowCount";
type FreeFieldErrors = Partial<Record<FreeFieldError, string>>;
type ToastState = { type: "error" | "success"; message: string } | null;

function toDigits(value: string) {
  return value.replace(/\D/g, "");
}

function getFrequencyPresentation(minutes: number): { value: string; unit: FrequencyUnit } {
  if (minutes >= 60 && minutes % 60 === 0) {
    return { value: String(minutes / 60), unit: "hours" };
  }
  return { value: String(minutes), unit: "minutes" };
}

export default function FreeRangeSettings() {
  const navigate = useNavigate();
  const location = useLocation();
  const backTarget = (location.state as { from?: string } | null)?.from ?? "/free-range";

  const [settings, setSettings] = useState<FreeRangeMonitoringSettings>(
    DEFAULT_FREE_RANGE_MONITORING_SETTINGS
  );
  const [snapshotFrequencyValue, setSnapshotFrequencyValue] = useState("5");
  const [snapshotFrequencyUnit, setSnapshotFrequencyUnit] = useState<FrequencyUnit>("minutes");
  const [lowCountValue, setLowCountValue] = useState("3");
  const [errors, setErrors] = useState<FreeFieldErrors>({});
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    getFreeRangeMonitoringSettings().then((loaded) => {
      setSettings(loaded);
      const presentation = getFrequencyPresentation(loaded.resultSnapshotFrequencyMinutes);
      setSnapshotFrequencyValue(presentation.value);
      setSnapshotFrequencyUnit(presentation.unit);
      setLowCountValue(String(loaded.lowCountWarningThreshold));
    }).catch((err) => {
      setToast({ type: "error", message: userMessage(err, "Unable to load settings. Please refresh.") });
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const currentLowCountPreview = useMemo(() => {
    const parsed = Number(lowCountValue);
    return lowCountValue && Number.isFinite(parsed) ? parsed : "--";
  }, [lowCountValue]);

  const update = <K extends keyof FreeRangeMonitoringSettings>(
    key: K,
    value: FreeRangeMonitoringSettings[K]
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setToast(null);
  };

  const clearError = (key: FreeFieldError) => {
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const validate = (): FreeFieldErrors => {
    const next: FreeFieldErrors = {};

    if (!settings.monitoringEnabled) return next;

    if (!settings.monitoringStartTime || !settings.monitoringEndTime) {
      next.timeWindow = "Please select both a monitoring start time and stop time.";
    } else if (settings.monitoringStartTime >= settings.monitoringEndTime) {
      next.timeWindow = "The stop time must be later than the start time.";
    }

    if (!snapshotFrequencyValue) {
      next.snapshotFrequency = "Please enter a result snapshot interval.";
    } else {
      const frequency = Number(snapshotFrequencyValue);
      if (!Number.isInteger(frequency) || frequency < 1) {
        next.snapshotFrequency = "Please enter a valid integer greater than or equal to 1.";
      } else if (snapshotFrequencyUnit === "minutes" && frequency > 1440) {
        next.snapshotFrequency = "The minute interval must be between 1 and 1440.";
      } else if (snapshotFrequencyUnit === "hours" && frequency > 24) {
        next.snapshotFrequency = "The hour interval must be between 1 and 24.";
      }
    }

    if (!lowCountValue) {
      next.lowCount = "Please enter a Low Count warning threshold.";
    } else {
      const lowCount = Number(lowCountValue);
      if (!Number.isInteger(lowCount) || lowCount < 1 || lowCount > 999) {
        next.lowCount = "The Low Count warning threshold must be between 1 and 999.";
      }
    }

    return next;
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setToast({ type: "error", message: "Settings were not saved. Please review the highlighted fields." });
      return;
    }

    const frequencyNumber = Number(snapshotFrequencyValue);
    const frequencyMinutes =
      snapshotFrequencyUnit === "hours" ? frequencyNumber * 60 : frequencyNumber;
    const lowCount = Number(lowCountValue);

    const nextSettings: FreeRangeMonitoringSettings = {
      ...settings,
      resultSnapshotFrequencyMinutes: frequencyMinutes,
      lowCountWarningThreshold: lowCount,
    };

    try {
      await updateFreeRangeMonitoringSettings(nextSettings);
    } catch (err) {
      setToast({ type: "error", message: userMessage(err, "Settings were not saved. Please try again.") });
      return;
    }
    setSettings(nextSettings);
    setToast({ type: "success", message: "Settings saved." });
  };

  return (
    <div className="app">
      <AppHeader />
      <main className="dashboard settings-page">
        <button className="back-button" onClick={() => navigate(backTarget)}>← Back</button>

        <div className="settings-page-heading">
          <div>
            <h1>Free-range Monitoring Settings</h1>
            <p>Configure continuous Pi-side AI monitoring while controlling when formal results are saved to the application.</p>
          </div>
        </div>

        <form className="settings-page-grid" onSubmit={handleSave} noValidate>
          <section className="settings-panel">
            <div className="settings-panel-heading">
              <span className="settings-hub-icon settings-hub-icon-free-range"><Icon name="leaf" size={19} /></span>
              <div><h2>Continuous Monitoring</h2><p>The camera supplies a video stream. Raspberry Pi repeatedly samples frames and runs the existing image AI model during the configured monitoring window.</p></div>
            </div>

            <div className="settings-row">
              <div>
                <div className="settings-title-line">
                  <strong>Monitoring Enabled</strong>
                  <InfoTooltip label="Turn automatic Free-range monitoring on or off. Turning it off stops new automatic detections but keeps all existing local and cloud history." />
                </div>
                <span>Control whether the Pi continues automatic Free-range monitoring.</span>
              </div>
              <button
                type="button"
                className={settings.monitoringEnabled ? "settings-toggle active" : "settings-toggle"}
                onClick={() => {
                  const nextEnabled = !settings.monitoringEnabled;
                  update("monitoringEnabled", nextEnabled);
                  if (!nextEnabled) setErrors({});
                }}
                aria-pressed={settings.monitoringEnabled}
              ><span /></button>
            </div>

            <fieldset className={settings.monitoringEnabled ? "monitoring-dependent" : "monitoring-dependent is-disabled"} disabled={!settings.monitoringEnabled}>
            <div className="continuous-ai-card">
              <div className="settings-block-title">
                <span>AI Monitoring: Continuous</span>
                <InfoTooltip label="The Pi continuously samples frames from the camera video stream and runs the existing image detection/classification model. Users do not configure the internal AI sampling rate." />
              </div>
              <p>AI inference runs repeatedly on sampled video frames. Only formal result snapshots are saved at the interval below.</p>
            </div>

            <div className="settings-time-block">
              <div className="settings-block-title">
                <span>Monitoring Time Window</span>
                <InfoTooltip label="Defines the daytime period when continuous Free-range AI monitoring is active. Outside this window no new automatic results are produced." />
              </div>
              <div className="settings-time-grid">
                <div className="profile-field">
                  <label htmlFor="free-start">Start time</label>
                  <input
                    id="free-start"
                    type="time"
                    value={settings.monitoringStartTime}
                    onChange={(e) => {
                      update("monitoringStartTime", e.target.value);
                      clearError("timeWindow");
                    }}
                  />
                </div>
                <div className="profile-field">
                  <label htmlFor="free-end">Stop time</label>
                  <input
                    id="free-end"
                    type="time"
                    value={settings.monitoringEndTime}
                    onChange={(e) => {
                      update("monitoringEndTime", e.target.value);
                      clearError("timeWindow");
                    }}
                  />
                </div>
              </div>
              {errors.timeWindow && <span className="settings-field-error">{errors.timeWindow}</span>}
            </div>

            <div className="profile-field">
              <label className="settings-field-label" htmlFor="free-snapshot-frequency">
                <span>Result Snapshot Interval</span>
                <InfoTooltip label="Controls how often the system saves one formal Free-range result and annotated snapshot for History, Alerts and Web/App display. AI continues running between snapshots." />
              </label>
              <div className={errors.snapshotFrequency ? "frequency-input frequency-input-error frequency-input-with-select" : "frequency-input frequency-input-with-select"}>
                <input
                  id="free-snapshot-frequency"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={snapshotFrequencyValue}
                  onChange={(e) => {
                    setSnapshotFrequencyValue(toDigits(e.target.value));
                    clearError("snapshotFrequency");
                  }}
                  aria-invalid={Boolean(errors.snapshotFrequency)}
                />
                <select
                  aria-label="Result snapshot interval unit"
                  value={snapshotFrequencyUnit}
                  onChange={(e) => {
                    setSnapshotFrequencyUnit(e.target.value as FrequencyUnit);
                    clearError("snapshotFrequency");
                  }}
                >
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                </select>
              </div>
              {errors.snapshotFrequency && <span className="settings-field-error">{errors.snapshotFrequency}</span>}
              <small>Raw video is not uploaded as a live stream. The application receives periodic structured results and selected snapshots.</small>
            </div>
            </fieldset>
          </section>

          <section className="settings-panel">
            <div className="settings-panel-heading">
              <span className="settings-hub-icon settings-hub-icon-alert"><Icon name="warning" size={19} /></span>
              <div><h2>Warning Rule</h2><p>Free-range Warning uses Low Count because the moving flock does not provide a stable overall denominator.</p></div>
            </div>

            <fieldset className={settings.monitoringEnabled ? "monitoring-dependent" : "monitoring-dependent is-disabled"} disabled={!settings.monitoringEnabled}>
            <div className="profile-field">
              <label className="settings-field-label" htmlFor="free-low-count">
                <span>Low Count Warning Threshold</span>
                <InfoTooltip label="A Free-range device enters Warning when two consecutive saved result snapshots each contain at least this many Low-production chickens." />
              </label>
              <div className={errors.lowCount ? "frequency-input frequency-input-error" : "frequency-input"}>
                <input
                  id="free-low-count"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={lowCountValue}
                  onChange={(e) => {
                    setLowCountValue(toDigits(e.target.value));
                    clearError("lowCount");
                  }}
                  aria-invalid={Boolean(errors.lowCount)}
                />
                <span>birds</span>
              </div>
              {errors.lowCount && <span className="settings-field-error">{errors.lowCount}</span>}
              <small>A warning requires two consecutive formal result snapshots at or above the configured Low Count.</small>
            </div>

            <div className="rule-preview">
              <strong>Current rule</strong>
              <span>Low count ≥ {currentLowCountPreview} for 2 consecutive result snapshots → Warning</span>
            </div>

            <div className="settings-explainer">
              <Icon name="info" size={17} />
              <span>Current-snapshot Normal/Low ratios can still be displayed for context, but they are not treated as the overall Free-range flock ratio.</span>
            </div>
            </fieldset>
          </section>

          <div className="settings-page-actions">
            <div />
            <button type="submit" className="profile-save-button">Save Changes</button>
          </div>
        </form>

        {toast && <div className={`settings-toast ${toast.type}`}>{toast.message}</div>}
      </main>
    </div>
  );
}
