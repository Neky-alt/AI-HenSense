import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";

import AppHeader from "../components/AppHeader";
import BackendStatus from "../components/BackendStatus";
import { useBackendData } from "../hooks/useBackendData";
import { userMessage } from "../lib/userMessages";
import { LOCAL_BACKEND_WRITES } from "../services/apiClient";
import { loadDevice } from "../services/detectionService";
import type { Device } from "../types/device";
import { DEVICE_NAME_MAX_LENGTH, renameDevice } from "../services/deviceService";

const FARMING_TYPE_LABEL = { caged: "Caged", free_range: "Free-range" } as const;

export default function EditDevice() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const request = useBackendData(loadDevice, id);
  const device = request.data;

  if (!device) {
    return (
      <div className="app">
        <AppHeader />
        <main className="dashboard">
          <button className="back-button" onClick={() => navigate(-1)}>← Back</button>
          <BackendStatus {...request} />
        </main>
      </div>
    );
  }

  // Keyed so the form starts again from the Backend value for each device.
  return <EditDeviceForm key={device.device_id} device={device} />;
}

function EditDeviceForm({ device }: { device: Device }) {
  const navigate = useNavigate();
  const [deviceName, setDeviceName] = useState(device.device_name);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const listPath = device.farming_type === "caged" ? "/cages" : "/free-range";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const trimmed = deviceName.trim();
    if (!trimmed || trimmed.length > DEVICE_NAME_MAX_LENGTH) {
      setError(`Enter a device name (up to ${DEVICE_NAME_MAX_LENGTH} characters).`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await renameDevice(device.device_id, trimmed);
      setDeviceName(updated.device_name ?? trimmed);
      setSaved(true);
    } catch (err) {
      setError(userMessage(err, "Unable to save changes. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app">
      <AppHeader />
      <main className="dashboard device-form-page">
        <button className="back-button" onClick={() => navigate(-1)}>← Back</button>

        <div className="form-card">
          <div className="form-header">
            <h1>Edit Device</h1>
            <p>Only the device name can be changed. Device ID and farming type are fixed when the device is added.</p>
          </div>

          <form noValidate className="device-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="device-code">Device ID</label>
              <input id="device-code" type="text" value={device.device_code} disabled />
            </div>

            <div className="form-group">
              <label htmlFor="device-name">Device Name</label>
              <input
                id="device-name"
                type="text"
                maxLength={DEVICE_NAME_MAX_LENGTH}
                value={deviceName}
                disabled={saving || !LOCAL_BACKEND_WRITES}
                onChange={(event) => {
                  setDeviceName(event.target.value);
                  setError("");
                }}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="farming-type">Farming Type</label>
              <input id="farming-type" type="text" value={FARMING_TYPE_LABEL[device.farming_type]} disabled />
            </div>

            {!LOCAL_BACKEND_WRITES && <p className="form-hint">Editing requires the local Backend.</p>}
            {error && <div role="alert" className="form-error">{error}</div>}

            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => navigate(-1)} disabled={saving}>Cancel</button>
              <button type="submit" className="primary-button" disabled={saving || !LOCAL_BACKEND_WRITES}>
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </main>

      {saved && (
        <div className="modal-overlay">
          <div className="system-modal" role="dialog" aria-modal="true">
            <div className="success-icon">✓</div>
            <h2>Device Updated</h2>
            <p>The device name has been saved.</p>
            <div className="modal-device-info">
              <span>Device</span>
              <strong>{deviceName}</strong>
              <small>{device.device_code}</small>
            </div>
            <button className="modal-confirm-button" onClick={() => navigate(listPath)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
