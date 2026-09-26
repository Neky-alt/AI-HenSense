import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import AlertsMailbox from "./AlertsMailbox";
import Icon from "./Icon";
import { useAuth } from "../contexts/AuthContext";
import { getProfileAvatar, getRemoteProfile } from "../services/profileService";
import { loadDevices } from "../services/detectionService";
import { useBackendData } from "../hooks/useBackendData";
import BackendStatus from "./BackendStatus";
import type { Device } from "../types/device";
import hensenseTransparentLogo from "../assets/brand/hensense-logo.png";

const navItems = [
  { to: "/", label: "Home", icon: "home" as const, end: true },
  { to: "/cages", label: "Cage", icon: "cage" as const },
  { to: "/free-range", label: "Free-range", icon: "leaf" as const },
  { to: "/alerts", label: "Alerts", icon: "bell" as const },
  { to: "/profile", label: "Profile", icon: "user" as const },
];

function getFarmingTypeLabel(device: Device) {
  return device.farming_type === "caged" ? "Cage" : "Free-range";
}

export default function AppHeader() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [freshName, setFreshName] = useState<string | null>(null);
  const request = useBackendData(loadDevices);
  const deviceList = useMemo(() => request.data ?? [], [request.data]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const email = user?.email ?? "";

  const metadataName =
    typeof user?.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : "";

  const displayName = freshName || metadataName || email.split("@")[0] || "Account";
  const initial = displayName.charAt(0).toUpperCase();

  const searchResults = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) return [];

    return deviceList
      .filter((device) => {
        const searchableText = [
          device.device_name,
          device.device_code,
          device.device_id,
          getFarmingTypeLabel(device),
        ]
          .join(" ")
          .toLowerCase();

        return searchableText.includes(keyword);
      })
      .slice(0, 6);
  }, [deviceList, searchQuery]);



  useEffect(() => {
    let active = true;

    const loadAvatar = async () => {
      if (!user?.id) {
        if (active) { setAvatarUrl(null); setFreshName(null); }
        return;
      }

      try {
        const [avatar, profile] = await Promise.all([getProfileAvatar(user.id), getRemoteProfile()]);
        if (active) { setAvatarUrl(avatar); setFreshName(profile.displayName); }
      } catch (error) {
        console.warn('Unable to refresh shared profile:', error);
        if (active) setAvatarUrl(null);
      }
    };

    loadAvatar();

    const handleProfileUpdated = () => loadAvatar();
    window.addEventListener("profile-updated", handleProfileUpdated);
    window.addEventListener("focus", handleProfileUpdated);

    return () => {
      active = false;
      window.removeEventListener("profile-updated", handleProfileUpdated);
      window.removeEventListener("focus", handleProfileUpdated);
    };
  }, [user?.id]);

  const openDevice = (deviceId: string) => {
    setSearchQuery("");
    setSearchFocused(false);
    navigate(`/devices/${deviceId}`);
  };

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (searchResults[0]) openDevice(searchResults[0].device_id);
  };

  return (
    <>
      <aside className="sidebar">
        <NavLink to="/" className="sidebar-brand" aria-label="HenSense home">
          <span className="sidebar-brand-wordmark" aria-hidden="true">
            <img src={hensenseTransparentLogo} className="sidebar-brand-wordmark-icon" alt="" />
            <span className="sidebar-brand-wordmark-name"><span>Hen</span><span>Sense</span></span>
          </span>
          <img
            src={hensenseTransparentLogo}
            alt=""
            aria-hidden="true"
            className="sidebar-brand-logo sidebar-brand-logo-compact"
          />
        </NavLink>

        <nav className="sidebar-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                isActive ? "sidebar-link active" : "sidebar-link"
              }
            >
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <div className="sidebar-footer">
          <strong>HenSense</strong>
          <small>Healthier Birds, Brighter Farms</small>
          <small>v1.0.0</small>
        </div>
      </aside>

      <header className="topbar app-header">
        <div className="global-search-wrap">
          <form className="global-search" role="search" onSubmit={handleSearchSubmit}>
            <Icon name="search" size={18} />
            <input
              aria-label="Search devices"
              placeholder="Search devices by ID or name..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
              autoComplete="off"
            />
          </form>

          {searchFocused && searchQuery.trim() && (
            <div className="global-search-results" role="listbox" aria-label="Device search results">
              {request.loading || request.error ? <BackendStatus {...request} /> : searchResults.length > 0 ? (
                searchResults.map((device) => (
                  <button
                    type="button"
                    className="global-search-result"
                    key={device.device_id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => openDevice(device.device_id)}
                  >
                    <span className={`search-result-icon search-result-${device.farming_type}`}>
                      <Icon name={device.farming_type === "caged" ? "cage" : "leaf"} size={17} />
                    </span>
                    <span className="search-result-copy">
                      <strong>{device.device_name}</strong>
                      <small>{device.device_code} · {getFarmingTypeLabel(device)}</small>
                    </span>
                    <span className={`search-result-status connection-${device.device_status}`}>
                      <span className="connection-dot" />
                      {device.device_status === "online"
                        ? "Online"
                        : device.device_status === "offline"
                          ? "Offline"
                          : "Error"}
                    </span>
                    <Icon name="chevron" size={15} />
                  </button>
                ))
              ) : (
                <div className="global-search-empty">
                  <strong>No devices found</strong>
                  <span>Try a device name or ID.</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="app-header-right">
          <AlertsMailbox />

          <button
            className="profile-shortcut"
            onClick={() => navigate("/profile")}
            aria-label="Open profile"
          >
            <span className="profile-avatar">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : initial}
            </span>

            <span className="profile-shortcut-copy">
              <strong>{displayName}</strong>
              <small>{email}</small>
            </span>

            <Icon name="chevron" size={16} />
          </button>
        </div>
      </header>
    </>
  );
}
