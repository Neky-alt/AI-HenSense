import {
  useState,
  type FormEvent,
} from "react";

import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import cage01 from "../assets/mock/cage-01.jpg";
import freeRange from "../assets/mock/free-range.jpg";

import type {
  Device,
  FarmingType,
} from "../types/device";

import {
  addDevice,
  getDevices,
} from "../utils/deviceStorage";

export default function AddDevice() {
  const navigate = useNavigate();

  const [deviceCode, setDeviceCode] =
    useState("");

  const [deviceName, setDeviceName] =
    useState("");

  const [farmingType, setFarmingType] =
    useState<FarmingType>("caged");

  const [error, setError] =
    useState("");

  const [
    showSuccessModal,
    setShowSuccessModal,
  ] = useState(false);

  const handleSubmit = (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    const trimmedCode =
      deviceCode.trim().toUpperCase();

    const trimmedName =
      deviceName.trim();

    if (!trimmedCode || !trimmedName) {
      setError(
        "Please complete all required fields."
      );

      return;
    }

    const existingDevices =
      getDevices();

    const codeExists =
      existingDevices.some(
        (device) =>
          device.device_code
            .toLowerCase() ===
          trimmedCode.toLowerCase()
      );

    if (codeExists) {
      setError(
        "This Device ID already exists."
      );

      return;
    }

    const newDevice: Device = {
      device_id: Date.now().toString(),

      device_code: trimmedCode,

      device_name: trimmedName,

      farming_type: farmingType,

      device_status: "offline",

      monitoring_status: "normal",

      normal_count: 0,

      low_count: 0,

      total_count: 0,

      normal_ratio: null,

      low_ratio: null,

      image_url: farmingType === "caged" ? cage01 : freeRange,

      last_updated: "Just added",
    };

    addDevice(newDevice);

    setDeviceCode(trimmedCode);
    setDeviceName(trimmedName);

    setShowSuccessModal(true);
  };

  const handleSuccessClose = () => {
    setShowSuccessModal(false);

    if (farmingType === "caged") {
      navigate("/cages");
    } else {
      navigate("/free-range");
    }
  };

  return (
    <div className="app">
      <AppHeader />

      <main className="dashboard device-form-page">
        <button
          className="back-button"
          onClick={() => navigate(-1)}
        >
          ← Back
        </button>

        <div className="form-card">
          <div className="form-header">
            <h1>Add Device</h1>

            <p>
              Add a new monitoring device to
              the poultry monitoring system.
            </p>
          </div>

          <form noValidate
            className="device-form"
            onSubmit={handleSubmit}
          >
            <div className="form-group">
              <label htmlFor="device-code">
                Device ID
              </label>

              <input
                id="device-code"
                type="text"
                placeholder={
                farmingType === "caged"
                    ? "e.g. PI-005"
                    : "e.g. FR-002"
                }
                value={deviceCode}
                onChange={(event) => {
                  setDeviceCode(
                    event.target.value
                  );

                  setError("");
                }}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="device-name">
                Device Name
              </label>

              <input
                id="device-name"
                type="text"
                placeholder={
                farmingType === "caged"
                   ? "e.g. Cage C-05"
                   : "e.g. Free-range Camera 02"
                }
                value={deviceName}
                onChange={(event) => {
                  setDeviceName(
                    event.target.value
                  );

                  setError("");
                }}
                required
              />
            </div>

            <div className="form-group">
              <label>
                Farming Type
              </label>

              <div className="farming-type-options">
                <label
                  className={
                    farmingType === "caged"
                      ? "farming-option selected"
                      : "farming-option"
                  }
                >
                  <input
                    type="radio"
                    name="farming-type"
                    checked={
                      farmingType === "caged"
                    }
                    onChange={() =>
                      setFarmingType("caged")
                    }
                  />

                  <div>
                    <strong>
                      Caged
                    </strong>

                    <span>
                      Monitor chickens in cages.
                    </span>
                  </div>
                </label>

                <label
                  className={
                    farmingType ===
                    "free_range"
                      ? "farming-option selected"
                      : "farming-option"
                  }
                >
                  <input
                    type="radio"
                    name="farming-type"
                    checked={
                      farmingType ===
                      "free_range"
                    }
                    onChange={() =>
                      setFarmingType(
                        "free_range"
                      )
                    }
                  />

                  <div>
                    <strong>
                      Free-range
                    </strong>

                    <span>
                      Monitor chickens using a camera.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {error && (
              <div className="form-error">
                {error}
              </div>
            )}

            <div className="form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  navigate(-1)
                }
              >
                Cancel
              </button>

              <button
                type="submit"
                className="primary-button"
              >
                Add Device
              </button>
            </div>
          </form>
        </div>
      </main>

      {showSuccessModal && (
        <div className="modal-overlay">
          <div
            className="system-modal"
            role="dialog"
            aria-modal="true"
          >
            <div className="success-icon">
              ✓
            </div>

            <h2>
              Device Added
            </h2>

            <p>
              The device has been added
              successfully.
            </p>

            <div className="modal-device-info">
              <span>Device</span>

              <strong>
                {deviceName}
              </strong>

              <small>
                {deviceCode}
              </small>
            </div>

            <button
              className="modal-confirm-button"
              onClick={handleSuccessClose}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}