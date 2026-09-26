import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";

import AppHeader from "../components/AppHeader";
import Icon from "../components/Icon";
import InfoTooltip from "../components/InfoTooltip";
import {
  getDeviceMediaStorageSettings,
  getDeviceStorageStatus,
  updateDeviceMediaStorageSettings,
} from "../services/settingsService";
import {
  DEFAULT_DEVICE_MEDIA_STORAGE_SETTINGS,
  type DeviceMediaStorageSettings,
  type DeviceStorageStatus,
  type StorageLimitAction,
} from "../types/settings";
import { getDeviceById } from "../utils/deviceStorage";

type StorageFieldError = "storageLimit" | "imageRetention" | "videoRetention";
type StorageFieldErrors = Partial<Record<StorageFieldError, string>>;
type ToastState = { type: "error" | "success"; message: string } | null;

const DEFAULT_STATUS: DeviceStorageStatus = {
  capacityGb: 128,
  usedGb: 32,
  availableGb: 96,
};

function toDigits(value: string) {
  return value.replace(/\D/g, "");
}

export default function DeviceStorageSettings() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const device = id ? getDeviceById(id) : undefined;
  const isFreeRange = device?.farming_type === "free_range";

  const [settings, setSettings] = useState<DeviceMediaStorageSettings>(
    DEFAULT_DEVICE_MEDIA_STORAGE_SETTINGS
  );
  const [status, setStatus] = useState<DeviceStorageStatus>(DEFAULT_STATUS);
  const [storageLimitValue, setStorageLimitValue] = useState("80");
  const [imageRetentionValue, setImageRetentionValue] = useState("30");
  const [videoRetentionValue, setVideoRetentionValue] = useState("7");
  const [errors, setErrors] = useState<StorageFieldErrors>({});
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getDeviceMediaStorageSettings(id),
      getDeviceStorageStatus(id),
    ]).then(([loadedSettings, loadedStatus]) => {
      setSettings(
        device?.farming_type === "free_range"
          ? loadedSettings
          : { ...loadedSettings, storeVideoLocally: false }
      );
      setStatus(loadedStatus);
      setStorageLimitValue(String(loadedSettings.maximumMediaStorageGb));
      setImageRetentionValue(String(loadedSettings.detectionImageRetentionDays));
      setVideoRetentionValue(String(loadedSettings.videoRetentionDays));
    });
  }, [id, device?.farming_type]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const update = <K extends keyof DeviceMediaStorageSettings>(
    key: K,
    value: DeviceMediaStorageSettings[K]
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setToast(null);
  };

  const clearError = (key: StorageFieldError) => {
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const validate = (): StorageFieldErrors => {
    const next: StorageFieldErrors = {};

    if (!storageLimitValue) {
      next.storageLimit = isFreeRange
        ? "Please enter the maximum media storage limit."
        : "Please enter the maximum image storage limit.";
    } else {
      const limit = Number(storageLimitValue);
      if (!Number.isInteger(limit) || limit < 1) {
        next.storageLimit = isFreeRange
          ? "Maximum media storage must be an integer greater than or equal to 1."
          : "Maximum image storage must be an integer greater than or equal to 1.";
      } else if (limit > status.capacityGb) {
        next.storageLimit = isFreeRange
          ? "Maximum media storage cannot exceed the SD card capacity."
          : "Maximum image storage cannot exceed the SD card capacity.";
      }
    }

    if (settings.storeDetectionImages) {
      if (!imageRetentionValue) {
        next.imageRetention = "Please enter the detection image retention period.";
      } else {
        const days = Number(imageRetentionValue);
        if (!Number.isInteger(days) || days < 1 || days > 3650) {
          next.imageRetention = "Detection image retention must be between 1 and 3650 days.";
        }
      }
    }

    if (isFreeRange && settings.storeVideoLocally) {
      if (!videoRetentionValue) {
        next.videoRetention = "Please enter the video retention period.";
      } else {
        const days = Number(videoRetentionValue);
        if (!Number.isInteger(days) || days < 1 || days > 3650) {
          next.videoRetention = "Video retention must be between 1 and 3650 days.";
        }
      }
    }

    return next;
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id) return;

    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setToast({ type: "error", message: "Settings were not saved. Please review the highlighted fields." });
      return;
    }

    const nextSettings: DeviceMediaStorageSettings = {
      ...settings,
      storeVideoLocally: isFreeRange ? settings.storeVideoLocally : false,
      maximumMediaStorageGb: Number(storageLimitValue),
      detectionImageRetentionDays: settings.storeDetectionImages
        ? Number(imageRetentionValue)
        : settings.detectionImageRetentionDays,
      videoRetentionDays: isFreeRange && settings.storeVideoLocally
        ? Number(videoRetentionValue)
        : settings.videoRetentionDays,
    };

    await updateDeviceMediaStorageSettings(id, nextSettings);
    setSettings(nextSettings);
    setToast({ type: "success", message: "Settings saved." });
  };

  if (!device || !id) {
    return (
      <div className="app">
        <AppHeader />
        <main className="dashboard">
          <button className="back-button" onClick={() => navigate("/")}>← Back</button>
          <p>Device not found.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <AppHeader />
      <main className="dashboard settings-page">
        <button className="back-button" onClick={() => navigate(`/devices/${device.device_id}`)}>← Back to {device.device_name}</button>

        <div className="settings-page-heading">
          <div>
            <h1>Local Media Storage</h1>
            <p>
              {isFreeRange
                ? `Manage detection images and local video stored on ${device.device_name}'s SD card.`
                : `Manage detection images stored on ${device.device_name}'s SD card. Cage monitoring does not require continuous video recording.`}
              {" "}Detection records remain separate from media files.
            </p>
          </div>
        </div>

        <section className="storage-status-grid">
          <div className="storage-status-card">
            <span>SD Card Capacity</span>
            <strong>{status.capacityGb} GB</strong>
          </div>
          <div className="storage-status-card">
            <span>Used</span>
            <strong>{status.usedGb} GB</strong>
          </div>
          <div className="storage-status-card">
            <span>Available</span>
            <strong>{status.availableGb} GB</strong>
          </div>
        </section>

        <form className="settings-single-column storage-settings-form" onSubmit={handleSave} noValidate>
          <section className="settings-panel storage-settings-panel">
            <div className="settings-panel-heading">
              <span className="settings-hub-icon settings-hub-icon-cage"><Icon name="device" size={19} /></span>
              <div>
                <h2>{isFreeRange ? "Media Storage" : "Detection Image Storage"}</h2>
                <p>
                  {isFreeRange
                    ? "Detection images and local video share this device's SD-card space. Their retention rules are managed separately below."
                    : "Cage devices store scheduled detection images only. Continuous video recording is not required for Cage monitoring."}
                </p>
              </div>
            </div>

            <section className="storage-subsection storage-subsection-images">
              <div className="storage-subsection-heading">
                <div>
                  <h3>Detection Images</h3>
                  <p>Store image evidence linked to Detection History records.</p>
                </div>
                <span className="storage-subsection-summary">
                  {settings.storeDetectionImages ? `Enabled · ${imageRetentionValue || "—"} days` : "Disabled"}
                </span>
              </div>

              <div className="settings-row storage-toggle-row">
                <div>
                  <div className="settings-title-line">
                    <strong>Store Detection Images</strong>
                    <InfoTooltip label="Save original and/or annotated detection images on this device's SD card. Turning this off does not delete images that are already stored." />
                  </div>
                  <span>Keep local image evidence for detection results.</span>
                </div>
                <button
                  type="button"
                  className={settings.storeDetectionImages ? "settings-toggle active" : "settings-toggle"}
                  onClick={() => {
                    update("storeDetectionImages", !settings.storeDetectionImages);
                    clearError("imageRetention");
                  }}
                  aria-pressed={settings.storeDetectionImages}
                ><span /></button>
              </div>

              <div className={settings.storeDetectionImages ? "profile-field" : "profile-field settings-field-disabled"}>
                <label className="settings-field-label" htmlFor="image-retention-days">
                  <span>Detection Image Retention</span>
                  <InfoTooltip label="How many days detection images should remain on the SD card before they become eligible for automatic cleanup. The structured Detection History record remains available after the image is removed." />
                </label>
                <div className={errors.imageRetention ? "frequency-input frequency-input-error" : "frequency-input"}>
                  <input
                    id="image-retention-days"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    disabled={!settings.storeDetectionImages}
                    value={imageRetentionValue}
                    onChange={(e) => {
                      setImageRetentionValue(toDigits(e.target.value));
                      clearError("imageRetention");
                    }}
                    aria-invalid={Boolean(errors.imageRetention)}
                  />
                  <span>days</span>
                </div>
                {errors.imageRetention && <span className="settings-field-error">{errors.imageRetention}</span>}
                <small>When an image expires, only the media file is removed; counts, ratios, status and timestamps remain in Detection History.</small>
              </div>
            </section>

            {isFreeRange && (
              <section className="storage-subsection storage-subsection-video">
              <div className="storage-subsection-heading">
                <div>
                  <h3>Local Video</h3>
                  <p>Keep camera video on the device without uploading the full live stream to cloud storage.</p>
                </div>
                <span className="storage-subsection-summary">
                  {settings.storeVideoLocally ? `Enabled · ${videoRetentionValue || "—"} days` : "Disabled"}
                </span>
              </div>

              <div className="settings-row storage-toggle-row">
                <div>
                  <div className="settings-title-line">
                    <strong>Store Video Locally</strong>
                    <InfoTooltip label="Control whether camera video is written to the local SD card. Cloud storage does not receive the full live video by default." />
                  </div>
                  <span>Keep local camera video without requiring cloud video upload.</span>
                </div>
                <button
                  type="button"
                  className={settings.storeVideoLocally ? "settings-toggle active" : "settings-toggle"}
                  onClick={() => {
                    update("storeVideoLocally", !settings.storeVideoLocally);
                    clearError("videoRetention");
                  }}
                  aria-pressed={settings.storeVideoLocally}
                ><span /></button>
              </div>

              <div className={settings.storeVideoLocally ? "profile-field" : "profile-field settings-field-disabled"}>
                <label className="settings-field-label" htmlFor="video-retention-days">
                  <span>Video Retention</span>
                  <InfoTooltip label="How many days local video should be kept before automatic cleanup. Video is organised by date and stored as multiple time-segment files rather than one very large all-day file." />
                </label>
                <div className={errors.videoRetention ? "frequency-input frequency-input-error" : "frequency-input"}>
                  <input
                    id="video-retention-days"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    disabled={!settings.storeVideoLocally}
                    value={videoRetentionValue}
                    onChange={(e) => {
                      setVideoRetentionValue(toDigits(e.target.value));
                      clearError("videoRetention");
                    }}
                    aria-invalid={Boolean(errors.videoRetention)}
                  />
                  <span>days</span>
                </div>
                {errors.videoRetention && <span className="settings-field-error">{errors.videoRetention}</span>}
                <small>Video is grouped by date for retention management. Each day is split into smaller time-based files to reduce corruption risk and make playback and cleanup easier.</small>
              </div>
            </section>
            )}

            <section className="storage-subsection storage-subsection-policy">
              <div className="storage-subsection-heading">
                <div>
                  <h3>Storage Policy</h3>
                  <p>
                    {isFreeRange
                      ? "Set the shared SD-card space limit for detection images and local video, and choose what happens when that limit is reached."
                      : "Set the SD-card space limit for Cage detection images and choose what happens when that limit is reached."}
                  </p>
                </div>
              </div>

              <div className="profile-field">
                <label className="settings-field-label" htmlFor="media-storage-limit">
                  <span>{isFreeRange ? "Maximum Media Storage" : "Maximum Image Storage"}</span>
                  <InfoTooltip
                    label={
                      isFreeRange
                        ? "Maximum SD-card space that HenSense may use for local detection images and video together. The device's total capacity is read automatically and cannot be edited here."
                        : "Maximum SD-card space that HenSense may use for Cage detection images. Cage monitoring does not continuously record video. The device's total capacity is read automatically and cannot be edited here."
                    }
                  />
                </label>
                <div className={errors.storageLimit ? "frequency-input frequency-input-error" : "frequency-input"}>
                  <input
                    id="media-storage-limit"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={storageLimitValue}
                    onChange={(e) => {
                      setStorageLimitValue(toDigits(e.target.value));
                      clearError("storageLimit");
                    }}
                    aria-invalid={Boolean(errors.storageLimit)}
                  />
                  <span>GB</span>
                </div>
                {errors.storageLimit && <span className="settings-field-error">{errors.storageLimit}</span>}
                <small>
                  Current prototype reports {status.availableGb} GB available on this device.
                  {isFreeRange
                    ? " This limit is shared by detection images and locally stored video."
                    : " This limit applies to locally stored Cage detection images."}
                </small>
              </div>

              <div className="profile-field">
                <label className="settings-field-label" htmlFor="storage-limit-action">
                  <span>When Storage Limit Is Reached</span>
                  <InfoTooltip
                  label={
                    isFreeRange
                      ? "Delete oldest media automatically is recommended because monitoring can continue without filling the SD card. This removes image/video files only, not structured Detection History."
                      : "Delete oldest images automatically is recommended because Cage monitoring can continue without filling the SD card. This removes detection image files only, not structured Detection History."
                  }
                />
                </label>
                <select
                  id="storage-limit-action"
                  value={settings.storageLimitAction}
                  onChange={(e) => update("storageLimitAction", e.target.value as StorageLimitAction)}
                >
                  <option value="delete_oldest">{isFreeRange ? "Delete oldest media automatically" : "Delete oldest images automatically"}</option>
                  <option value="stop_recording">{isFreeRange ? "Stop recording new media" : "Stop saving new images"}</option>
                </select>
              </div>

              <div className="settings-explainer">
                <Icon name="info" size={17} />
                <span>
                  {isFreeRange
                    ? "Automatic cleanup removes expired image or video media only. Detection records remain unless a user explicitly chooses Delete record from Detection History."
                    : "Automatic cleanup removes expired detection images only. Detection records remain unless a user explicitly chooses Delete record from Detection History."}
                </span>
              </div>
            </section>
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
