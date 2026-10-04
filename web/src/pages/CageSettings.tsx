import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import AppHeader from "../components/AppHeader";
import Icon from "../components/Icon";
import InfoTooltip from "../components/InfoTooltip";
import { userMessage } from "../lib/userMessages";
import {
  getCageMonitoringSettings,
  updateCageMonitoringSettings,
} from "../services/settingsService";
import {
  DEFAULT_CAGE_MONITORING_SETTINGS,
  type CageMonitoringSettings,
  type FrequencyUnit,
} from "../types/settings";

type CageFieldError =
  | "frequency"
  | "scheduledTimes"
  | "timeWindow"
  | "threshold";

type CageFieldErrors = Partial<Record<CageFieldError, string>>;

type ToastState = { type: "error" | "success"; message: string } | null;

function toDigits(value: string) {
  return value.replace(/\D/g, "");
}

function getFrequencyPresentation(minutes: number): { value: string; unit: FrequencyUnit } {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    return { value: String(minutes / 1440), unit: "days" };
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    return { value: String(minutes / 60), unit: "hours" };
  }
  return { value: String(minutes), unit: "minutes" };
}

function isTimeInsideWindow(time: string, start: string, end: string) {
  return time >= start && time <= end;
}

export default function CageSettings() {
  const navigate = useNavigate();
  const location = useLocation();
  const backTarget = (location.state as { from?: string } | null)?.from ?? "/cages";

  const [settings, setSettings] = useState<CageMonitoringSettings>(
    DEFAULT_CAGE_MONITORING_SETTINGS
  );
  const [frequencyValue, setFrequencyValue] = useState("30");
  const [frequencyUnit, setFrequencyUnit] = useState<FrequencyUnit>("minutes");
  const [thresholdValue, setThresholdValue] = useState("60");
  const [newScheduleTime, setNewScheduleTime] = useState("");
  const [errors, setErrors] = useState<CageFieldErrors>({});
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    getCageMonitoringSettings().then((loaded) => {
      setSettings(loaded);
      const presentation = getFrequencyPresentation(loaded.detectionFrequencyMinutes);
      setFrequencyValue(presentation.value);
      setFrequencyUnit(presentation.unit);
      setThresholdValue(String(Math.round(loaded.lowProductionWarningThreshold * 100)));
    }).catch((err) => {
      setToast({ type: "error", message: userMessage(err, "Unable to load settings. Please refresh.") });
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const currentThresholdPreview = useMemo(() => {
    const parsed = Number(thresholdValue);
    return thresholdValue && Number.isFinite(parsed) ? parsed : "--";
  }, [thresholdValue]);

  const update = <K extends keyof CageMonitoringSettings>(
    key: K,
    value: CageMonitoringSettings[K]
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setToast(null);
  };

  const clearError = (key: CageFieldError) => {
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const addScheduleTime = () => {
    if (!newScheduleTime) {
      const message = "Please select a detection time to add.";
      setErrors((current) => ({ ...current, scheduledTimes: message }));
      setToast({ type: "error", message });
      return;
    }
    if (settings.scheduledTimes.includes(newScheduleTime)) {
      const message = "Detection times cannot be duplicated.";
      setErrors((current) => ({ ...current, scheduledTimes: message }));
      setToast({ type: "error", message });
      return;
    }
    if (
      settings.captureStartTime &&
      settings.captureEndTime &&
      !isTimeInsideWindow(newScheduleTime, settings.captureStartTime, settings.captureEndTime)
    ) {
      const message = "Detection times must fall within the monitoring time window.";
      setErrors((current) => ({ ...current, scheduledTimes: message }));
      setToast({ type: "error", message });
      return;
    }

    update("scheduledTimes", [...settings.scheduledTimes, newScheduleTime].sort());
    setNewScheduleTime("");
    clearError("scheduledTimes");
  };

  const removeScheduleTime = (time: string) => {
    update(
      "scheduledTimes",
      settings.scheduledTimes.filter((item) => item !== time)
    );
  };

  const validate = (): CageFieldErrors => {
    const next: CageFieldErrors = {};

    if (!settings.monitoringEnabled) return next;

    if (!settings.captureStartTime || !settings.captureEndTime) {
      next.timeWindow = "Please select both a monitoring start time and stop time.";
    } else if (settings.captureStartTime >= settings.captureEndTime) {
      next.timeWindow = "The stop time must be later than the start time.";
    }

    if (settings.detectionMode === "interval") {
      if (!frequencyValue) {
        next.frequency = "Please enter a monitoring frequency.";
      } else {
        const frequency = Number(frequencyValue);
        if (!Number.isInteger(frequency) || frequency < 1) {
          next.frequency = "Please enter a valid integer greater than or equal to 1.";
        } else if (frequencyUnit === "minutes" && frequency > 1440) {
          next.frequency = "The minute frequency must be between 1 and 1440.";
        } else if (frequencyUnit === "hours" && frequency > 24) {
          next.frequency = "The hour frequency must be between 1 and 24.";
        } else if (frequencyUnit === "days" && frequency > 365) {
          next.frequency = "The day frequency must be between 1 and 365.";
        }
      }
    } else {
      if (settings.scheduledTimes.length === 0) {
        next.scheduledTimes = "Please add at least one detection time.";
      } else if (new Set(settings.scheduledTimes).size !== settings.scheduledTimes.length) {
        next.scheduledTimes = "Detection times cannot be duplicated.";
      } else if (
        settings.captureStartTime &&
        settings.captureEndTime &&
        settings.scheduledTimes.some(
          (time) => !isTimeInsideWindow(time, settings.captureStartTime, settings.captureEndTime)
        )
      ) {
        next.scheduledTimes = "Detection times must fall within the monitoring time window.";
      }
    }

    if (!thresholdValue) {
      next.threshold = "Please enter a Low-production warning threshold.";
    } else {
      const threshold = Number(thresholdValue);
      if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
        next.threshold = "The Low-production warning threshold must be between 1% and 100%.";
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

    const frequencyNumber = Number(frequencyValue || "0");
    const frequencyMinutes =
      frequencyUnit === "days"
        ? frequencyNumber * 1440
        : frequencyUnit === "hours"
          ? frequencyNumber * 60
          : frequencyNumber;
    const threshold = Number(thresholdValue) / 100;

    const nextSettings: CageMonitoringSettings = {
      ...settings,
      detectionFrequencyMinutes: frequencyMinutes,
      lowProductionWarningThreshold: threshold,
    };

    try {
      await updateCageMonitoringSettings(nextSettings);
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
            <h1>Cage Monitoring Settings</h1>
            <p>Configure how fixed cages are automatically checked and when a cage should enter Warning status.</p>
          </div>
        </div>

        <form className="settings-page-grid" onSubmit={handleSave} noValidate>
          <section className="settings-panel">
            <div className="settings-panel-heading">
              <span className="settings-hub-icon settings-hub-icon-cage"><Icon name="clock" size={19} /></span>
              <div><h2>Capture & Detection Schedule</h2><p>Each automatic check captures one current frame, runs AI immediately, and saves one detection result.</p></div>
            </div>

            <div className="settings-row">
              <div>
                <div className="settings-title-line">
                  <strong>Monitoring Enabled</strong>
                  <InfoTooltip label="Turn automatic monitoring on or off. Turning it off stops new automatic detections but does not delete any existing history, images, videos, or alerts." />
                </div>
                <span>Control whether this scenario produces new automatic Cage detections.</span>
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
            <div className="settings-config">
              <div className="profile-field">
                <label className="settings-field-label" htmlFor="cage-detection-mode">
                  <span>Detection Mode</span>
                  <InfoTooltip label="Fixed interval checks the cage repeatedly at the selected interval. Scheduled times runs checks only at the exact times you add." />
                </label>
                <select
                  id="cage-detection-mode"
                  value={settings.detectionMode}
                  onChange={(e) => {
                    update("detectionMode", e.target.value as CageMonitoringSettings["detectionMode"]);
                    clearError("frequency");
                    clearError("scheduledTimes");
                  }}
                >
                  <option value="interval">Fixed interval</option>
                  <option value="scheduled">Scheduled times</option>
                </select>
              </div>

              {settings.detectionMode === "interval" ? (
                <div className="profile-field">
                  <label className="settings-field-label" htmlFor="cage-detection-frequency">
                    <span>Monitoring Frequency</span>
                    <InfoTooltip label="How often the Cage system captures one still image and immediately runs one AI detection. Cage monitoring does not require continuous video recording. Minutes, hours and days are supported, and checks still follow the monitoring time window below." />
                  </label>
                  <div className={errors.frequency ? "frequency-input frequency-input-error frequency-input-with-select" : "frequency-input frequency-input-with-select"}>
                    <input
                      id="cage-detection-frequency"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={frequencyValue}
                      onChange={(e) => {
                        setFrequencyValue(toDigits(e.target.value));
                        clearError("frequency");
                      }}
                      aria-invalid={Boolean(errors.frequency)}
                    />
                    <select
                      aria-label="Monitoring frequency unit"
                      value={frequencyUnit}
                      onChange={(e) => {
                        setFrequencyUnit(e.target.value as FrequencyUnit);
                        clearError("frequency");
                      }}
                    >
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                    </select>
                  </div>
                  {errors.frequency && <span className="settings-field-error">{errors.frequency}</span>}
                </div>
              ) : (
                <div className="profile-field">
                  <label className="settings-field-label">
                    <span>Scheduled Detection Times</span>
                    <InfoTooltip label="Add one or more exact times for automatic Cage checks. Every scheduled time must fall inside the monitoring time window below." />
                  </label>
                  <div className="schedule-add-row">
                    <input
                      type="time"
                      value={newScheduleTime}
                      onChange={(e) => {
                        setNewScheduleTime(e.target.value);
                        clearError("scheduledTimes");
                      }}
                    />
                    <button type="button" disabled={!newScheduleTime} onClick={addScheduleTime}>Add</button>
                  </div>
                  <div className="schedule-chip-list">
                    {settings.scheduledTimes.map((time) => (
                      <span key={time} className="schedule-chip">
                        {time}
                        <button type="button" aria-label={`Remove ${time}`} onClick={() => removeScheduleTime(time)}>×</button>
                      </span>
                    ))}
                  </div>
                  {errors.scheduledTimes && <span className="settings-field-error">{errors.scheduledTimes}</span>}
                </div>
              )}
            </div>

            <div className="settings-time-block">
              <div className="settings-block-title">
                <span>Monitoring Time Window</span>
                <InfoTooltip label="Restricts automatic Cage image capture and detection to the selected daytime period, for example around midday when lighting is more suitable. If the interval is measured in days, the scheduled check is still performed within this window." />
              </div>
              <div className="settings-time-grid">
                <div className="profile-field">
                  <label htmlFor="cage-start">Start time</label>
                  <input
                    id="cage-start"
                    type="time"
                    value={settings.captureStartTime}
                    onChange={(e) => {
                      update("captureStartTime", e.target.value);
                      clearError("timeWindow");
                    }}
                  />
                </div>
                <div className="profile-field">
                  <label htmlFor="cage-end">Stop time</label>
                  <input
                    id="cage-end"
                    type="time"
                    value={settings.captureEndTime}
                    onChange={(e) => {
                      update("captureEndTime", e.target.value);
                      clearError("timeWindow");
                    }}
                  />
                </div>
              </div>
              {errors.timeWindow && <span className="settings-field-error">{errors.timeWindow}</span>}
            </div>
            </fieldset>
          </section>

          <section className="settings-panel">
            <div className="settings-panel-heading">
              <span className="settings-hub-icon settings-hub-icon-alert"><Icon name="warning" size={19} /></span>
              <div><h2>Warning Rule</h2><p>Define when a cage should enter Warning status. Alert notification preferences are configured separately.</p></div>
            </div>

            <fieldset className={settings.monitoringEnabled ? "monitoring-dependent" : "monitoring-dependent is-disabled"} disabled={!settings.monitoringEnabled}>
            <div className="profile-field">
              <label className="settings-field-label" htmlFor="cage-low-threshold">
                <span>Low-production Warning Threshold</span>
                <InfoTooltip label="A Cage enters Warning only when its Low-production Ratio reaches or exceeds this value for two consecutive detections. The default 60% is a prototype value, not an industry standard." />
              </label>
              <div className={errors.threshold ? "frequency-input frequency-input-error" : "frequency-input"}>
                <input
                  id="cage-low-threshold"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={thresholdValue}
                  onChange={(e) => {
                    setThresholdValue(toDigits(e.target.value));
                    clearError("threshold");
                  }}
                  aria-invalid={Boolean(errors.threshold)}
                />
                <span>%</span>
              </div>
              {errors.threshold && <span className="settings-field-error">{errors.threshold}</span>}
              <small>Prototype default: 60%. Warning requires two consecutive detections at or above the configured threshold.</small>
            </div>

            <div className="rule-preview">
              <strong>Current rule</strong>
              <span>Low-production ratio ≥ {currentThresholdPreview}% for 2 consecutive detections → Warning</span>
            </div>

            <div className="settings-explainer">
              <Icon name="info" size={17} />
              <span>Monitoring Status remains Normal or Warning. System alerts are created automatically from monitoring conditions; Alert Settings only control user-facing notifications.</span>
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
