import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { FarmingType } from "../types/device";
import { getDeviceById, updateDevice } from "../utils/deviceStorage";
import AppHeader from "../components/AppHeader";

export default function EditDevice() {
  const navigate = useNavigate();
  const { id } = useParams();
  const device = id ? getDeviceById(id) : undefined;

  const [deviceName, setDeviceName] = useState(device?.device_name ?? "");
  const [farmingType, setFarmingType] = useState<FarmingType>(
    device?.farming_type ?? "caged"
  );
  const [error,setError] = useState('');
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  if (!device) {
    return (
      <div className="app">
        <AppHeader />
        <main className="dashboard">
          <button className="back-button" onClick={() => navigate(-1)}>← Back</button>
          <div className="form-card">
            <h1>Device Not Found</h1>
            <p>The selected device could not be found.</p>
          </div>
        </main>
      </div>
    );
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if(!deviceName.trim()){setError('Enter a device name.');return;}
    setError('');

    updateDevice({
      ...device,
      device_name: deviceName.trim(),
      farming_type: farmingType,
    });

    setShowSuccessModal(true);
  };

  const handleSuccessClose = () => {
    setShowSuccessModal(false);
    navigate(farmingType === "caged" ? "/cages" : "/free-range");
  };

  return (
    <div className="app">
      <AppHeader />
      <main className="dashboard device-form-page">
        <button className="back-button" onClick={() => navigate(-1)}>← Back</button>

        <div className="form-card">
          <div className="form-header">
            <h1>Edit Device</h1>
            <p>Update the information for this monitoring device.</p>
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
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Farming Type</label>
              <div className="farming-type-options">
                <label className={farmingType === "caged" ? "farming-option selected" : "farming-option"}>
                  <input
                    type="radio"
                    name="farming-type"
                    checked={farmingType === "caged"}
                    onChange={() => setFarmingType("caged")}
                  />
                  <div><strong>Caged</strong><span>Monitor chickens in cages.</span></div>
                </label>

                <label className={farmingType === "free_range" ? "farming-option selected" : "farming-option"}>
                  <input
                    type="radio"
                    name="farming-type"
                    checked={farmingType === "free_range"}
                    onChange={() => setFarmingType("free_range")}
                  />
                  <div><strong>Free-range</strong><span>Monitor chickens in a free-range area.</span></div>
                </label>
              </div>
            </div>

            {error && <div role="alert" className="auth-error">{error}</div>}
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => navigate(-1)}>Cancel</button>
              <button type="submit" className="primary-button">Save Changes</button>
            </div>
          </form>
        </div>
      </main>

      {showSuccessModal && (
        <div className="modal-overlay">
          <div className="system-modal" role="dialog" aria-modal="true">
            <div className="success-icon">✓</div>
            <h2>Device Updated</h2>
            <p>The device information has been updated successfully.</p>
            <div className="modal-device-info">
              <span>Device</span>
              <strong>{deviceName}</strong>
              <small>{device.device_code}</small>
            </div>
            <button className="modal-confirm-button" onClick={handleSuccessClose}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
