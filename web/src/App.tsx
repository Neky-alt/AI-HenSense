import { BrowserRouter, Routes, Route } from "react-router-dom";

import "./App.css";

import Home from "./pages/Home";
import CageMonitoring from "./pages/CageMonitoring";
import FreeRangeMonitoring from "./pages/FreeRangeMonitoring";
import AddDevice from "./pages/AddDevice";
import EditDevice from "./pages/EditDevice";
import DeviceDetail from "./pages/DeviceDetail";
import DetectionDetail from "./pages/DetectionDetail";
import DeviceHistory from "./pages/DeviceHistory";
import Alerts from "./pages/Alerts";
import Profile from "./pages/Profile";
import CageSettings from "./pages/CageSettings";
import FreeRangeSettings from "./pages/FreeRangeSettings";
import AlertSettings from "./pages/AlertSettings";

import Login from "./pages/Login";
import PasswordRecovery from "./pages/PasswordRecovery";
import Register from "./pages/Register";
import ProtectedRoute from "./components/ProtectedRoute";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<PasswordRecovery />} />
        <Route path="/reset-password" element={<PasswordRecovery reset />} />

        {/* Protected routes */}
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Home />} />
          <Route path="/cages" element={<CageMonitoring />} />
          <Route path="/free-range" element={<FreeRangeMonitoring />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings/cage" element={<CageSettings />} />
          <Route path="/settings/free-range" element={<FreeRangeSettings />} />
          <Route path="/settings/alerts" element={<AlertSettings />} />

          <Route path="/devices/add" element={<AddDevice />} />
          <Route path="/devices/:id/edit" element={<EditDevice />} />
          <Route path="/devices/:id" element={<DeviceDetail />} />
          <Route path="/devices/:id/history" element={<DeviceHistory />} />

          <Route
            path="/devices/:id/detections/:detectionId"
            element={<DetectionDetail />}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;