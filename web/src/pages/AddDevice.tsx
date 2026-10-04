import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import AppHeader from "../components/AppHeader";
import type { FarmingType } from "../types/device";
import { userMessage } from "../lib/userMessages";
import { LOCAL_BACKEND_WRITES } from "../services/apiClient";
import type { ApiDevice } from "../services/detectionService";
import {
  createDevice,
  fieldForErrorCode,
  loadRemovedDevices,
  normalizeDeviceCode,
  purgeDevice,
  validateDeviceInput,
  type DeviceField,
} from "../services/deviceService";

export default function AddDevice() {
  const navigate = useNavigate();

  const [deviceCode, setDeviceCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [farmingType, setFarmingType] = useState<FarmingType>("caged");
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<DeviceField | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<ApiDevice | null>(null);
  // Set when the code belongs to one of the user's own removed devices.
  const [retired, setRetired] = useState<ApiDevice | null>(null);
  const [purging, setPurging] = useState(false);

  const listPath = (type: FarmingType) => (type === "caged" ? "/cages" : "/free-range");

  const clearError = () => {
    setError("");
    setErrorField(null);
    setRetired(null);
  };

  const submitDevice = async () => {
    setSubmitting(true);
    clearError();
    try {
      setCreated(await createDevice({ device_code: deviceCode, device_name: deviceName, farming_type: farmingType }));
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(userMessage(err, "Unable to add the device. Please try again."));
      setErrorField(fieldForErrorCode(code));
      if (code === "DEVICE_CODE_RETIRED") {
        const normalized = normalizeDeviceCode(deviceCode);
        try {
          const removed = await loadRemovedDevices();
          setRetired(removed.find((item) => item.device_code === normalized) ?? null);
        } catch {
          setRetired(null);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const invalid = validateDeviceInput(deviceCode, deviceName);
    if (invalid) {
      setError(invalid.message);
      setErrorField(invalid.field);
      return;
    }
    void submitDevice();
  };

  const purgeRetiredAndRetry = async () => {
    if (!retired) return;
    setPurging(true);
    try {
      await purgeDevice(retired.device_id);
      setRetired(null);
      await submitDevice();
    } catch (err) {
      setError(userMessage(err, "Unable to delete the old device history. Please try again."));
    } finally {
      setPurging(false);
    }
  };

  if (!LOCAL_BACKEND_WRITES) {
    return (
      <div className="app">
        <AppHeader />
        <main className="dashboard device-form-page">
          <button className="back-button" onClick={() => navigate(-1)}>← Back</button>
          <div className="form-card">
            <h1>Add Device</h1>
            <p>Adding devices requires the local Backend. Switch to local mode to add a device.</p>
          </div>
        </main>
      </div>
    );
  }

  const inputClass = (field: DeviceField) => (errorField === field ? "input-error" : undefined);

  return (
    <div className="app">
      <AppHeader />

      <main className="dashboard device-form-page">
        <button className="back-button" onClick={() => navigate(-1)}>← Back</button>

        <div className="form-card">
          <div className="form-header">
            <h1>Add Device</h1>
            <p>Register a Raspberry Pi monitoring device using the Device ID printed on it.</p>
          </div>

          <form noValidate className="device-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="device-code">Device ID</label>
              <input
                id="device-code"
                type="text"
                className={inputClass("device_code")}
                aria-invalid={errorField === "device_code"}
                placeholder={farmingType === "caged" ? "e.g. PI-005" : "e.g. FR-002"}
                value={deviceCode}
                disabled={submitting}
                onChange={(event) => {
                  setDeviceCode(event.target.value);
                  clearError();
                }}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="device-name">Device Name</label>
              <input
                id="device-name"
                type="text"
                className={inputClass("device_name")}
                aria-invalid={errorField === "device_name"}
                maxLength={64}
                placeholder={farmingType === "caged" ? "e.g. Cage C-05" : "e.g. Free-range Camera 02"}
                value={deviceName}
                disabled={submitting}
                onChange={(event) => {
                  setDeviceName(event.target.value);
                  clearError();
                }}
                required
              />
            </div>

            <div className="form-group">
              <label>Farming Type</label>
              <p className="form-hint">This cannot be changed after the device is added.</p>

              <div className="farming-type-options">
                <label className={farmingType === "caged" ? "farming-option selected" : "farming-option"}>
                  <input
                    type="radio"
                    name="farming-type"
                    checked={farmingType === "caged"}
                    disabled={submitting}
                    onChange={() => setFarmingType("caged")}
                  />
                  <div>
                    <strong>Caged</strong>
                    <span>Monitor chickens in cages.</span>
                  </div>
                </label>

                <label className={farmingType === "free_range" ? "farming-option selected" : "farming-option"}>
                  <input
                    type="radio"
                    name="farming-type"
                    checked={farmingType === "free_range"}
                    disabled={submitting}
                    onChange={() => setFarmingType("free_range")}
                  />
                  <div>
                    <strong>Free-range</strong>
                    <span>Monitor chickens using a camera.</span>
                  </div>
                </label>
              </div>
            </div>

            {error && (
              <div className="form-error" role="alert">
                {error}
                {retired && (
                  <div className="form-error-action">
                    <p>
                      “{retired.device_name || retired.device_code}” was removed earlier and its history is still kept.
                      Deleting that history permanently frees this Device ID.
                    </p>
                    <button type="button" className="danger-button" onClick={purgeRetiredAndRetry} disabled={purging || submitting}>
                      {purging ? "Deleting…" : "Delete old history and add this device"}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => navigate(-1)} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={submitting || purging}>
                {submitting ? "Adding…" : "Add Device"}
              </button>
            </div>
          </form>
        </div>
      </main>

      {created && (
        <div className="modal-overlay">
          <div className="system-modal" role="dialog" aria-modal="true">
            <div className="success-icon">✓</div>
            <h2>Device Added</h2>
            <p>The device shows as Offline until the Raspberry Pi sends its first heartbeat.</p>
            <div className="modal-device-info">
              <span>Device</span>
              <strong>{created.device_name || created.device_code}</strong>
              <small>{created.device_code}</small>
            </div>
            <button className="modal-confirm-button" onClick={() => navigate(listPath(created.farming_type))}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
