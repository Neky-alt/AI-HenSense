import { useState } from "react";

import type { Device } from "../types/device";
import { userMessage } from "../lib/userMessages";
import { purgeDevice, removeDevice, type DeleteMode } from "../services/deviceService";

interface Props {
  device: Pick<Device, "device_id" | "device_name" | "device_code">;
  onCancel: () => void;
  onDeleted: (mode: DeleteMode) => void;
}

/**
 * Two real Backend actions (docs/DEVICE_MANAGEMENT_API.md):
 * - remove: soft delete, history kept, Device ID stays reserved
 * - purge:  device + all history deleted locally and in the cloud, Device ID released
 */
export default function DeleteDeviceDialog({ device, onCancel, onDeleted }: Props) {
  const [mode, setMode] = useState<DeleteMode>("remove");
  const [confirmCode, setConfirmCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const purgeConfirmed = confirmCode.trim().toUpperCase() === device.device_code.toUpperCase();
  const canSubmit = !busy && (mode === "remove" || purgeConfirmed);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "purge") await purgeDevice(device.device_id);
      else await removeDevice(device.device_id);
      onDeleted(mode);
    } catch (err) {
      setError(userMessage(err, "Unable to delete this device. Please try again."));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="system-modal" role="dialog" aria-modal="true" aria-labelledby="delete-device-title">
        <div className="delete-icon">!</div>
        <h2 id="delete-device-title">Delete Device?</h2>

        <div className="modal-device-info">
          <span>Device</span>
          <strong>{device.device_name}</strong>
          <small>{device.device_code}</small>
        </div>

        <div className="farming-type-options delete-mode-options">
          <label className={mode === "remove" ? "farming-option selected" : "farming-option"}>
            <input type="radio" name="delete-mode" checked={mode === "remove"} disabled={busy} onChange={() => setMode("remove")} />
            <div>
              <strong>Remove device</strong>
              <span>Stop monitoring and hide it. Detection history is kept and this Device ID cannot be reused.</span>
            </div>
          </label>
          <label className={mode === "purge" ? "farming-option selected" : "farming-option"}>
            <input type="radio" name="delete-mode" checked={mode === "purge"} disabled={busy} onChange={() => setMode("purge")} />
            <div>
              <strong>Remove and delete all history</strong>
              <span>Permanently delete the device, its detections, alerts and images, including cloud copies. This cannot be undone.</span>
            </div>
          </label>
        </div>

        {mode === "purge" && (
          <div className="form-group">
            <label htmlFor="confirm-device-code">Type {device.device_code} to confirm</label>
            <input
              id="confirm-device-code"
              type="text"
              autoComplete="off"
              value={confirmCode}
              disabled={busy}
              onChange={(event) => setConfirmCode(event.target.value)}
            />
          </div>
        )}

        {error && <div className="form-error" role="alert">{error}</div>}

        <div className="delete-modal-actions">
          <button className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="danger-button" onClick={submit} disabled={!canSubmit}>
            {busy ? "Deleting…" : mode === "purge" ? "Delete Permanently" : "Remove Device"}
          </button>
        </div>
      </div>
    </div>
  );
}

