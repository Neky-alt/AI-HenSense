import type { Detection } from "../types/detection.ts";
import type { Device, CaptureSourceType } from "../types/device.ts";
import { apiGet, resolveBackendUrl } from "./apiClient.ts";

export interface ApiDetection extends Omit<Detection, "screenshot_url" | "source_type" | "confidence"> {
  capture_source_type: CaptureSourceType;
  trigger_type: "scheduled" | "manual" | "free_range_snapshot";
  confidence: number | null;
  image_path: string | null;
  image_url: string | null;
  image_deleted_at: string | null;
}

export interface ApiDevice {
  device_id: string;
  device_code: string;
  device_name: string | null;
  farming_type: Device["farming_type"];
  device_status: Device["device_status"];
  latest_detection: ApiDetection | null;
}

export function mapDetection(raw: ApiDetection, baseUrl?: string): Detection {
  // image_path is an opaque server-side file reference, never a browser URL.
  const imageRoute = raw.image_url || (raw.image_path
    ? `/api/v1/devices/${encodeURIComponent(raw.device_id)}/detections/${encodeURIComponent(raw.detection_id)}/image`
    : "");
  return {
    detection_id: raw.detection_id,
    device_id: raw.device_id,
    detected_at: raw.detected_at,
    total_count: raw.total_count,
    normal_count: raw.normal_count,
    low_count: raw.low_count,
    normal_ratio: raw.normal_ratio,
    low_ratio: raw.low_ratio,
    monitoring_status: raw.monitoring_status,
    source_type: raw.capture_source_type,
    trigger_type: raw.trigger_type,
    confidence: raw.confidence ?? undefined,
    annotated_image_url: raw.image_deleted_at || !raw.annotated_image_url ? "" : resolveBackendUrl(raw.annotated_image_url, baseUrl),
    screenshot_url: raw.image_deleted_at || !imageRoute ? "" : resolveBackendUrl(imageRoute, baseUrl),
  };
}

export function mapDevice(raw: ApiDevice): Device {
  // The Backend selects the formal snapshot for Free-range. Never replace it
  // with the first history row, which may be a manual single-frame detection.
  const latest = raw.latest_detection ? mapDetection(raw.latest_detection) : null;
  return {
    device_id: raw.device_id,
    device_code: raw.device_code,
    device_name: raw.device_name || raw.device_code,
    farming_type: raw.farming_type,
    device_status: raw.device_status,
    monitoring_status: latest?.monitoring_status ?? null,
    normal_count: latest?.normal_count ?? 0,
    low_count: latest?.low_count ?? 0,
    total_count: latest?.total_count ?? 0,
    normal_ratio: latest?.normal_ratio ?? null,
    low_ratio: latest?.low_ratio ?? null,
    image_url: latest?.screenshot_url ?? "",
    annotated_image_url: latest?.annotated_image_url ?? "",
    last_updated: latest ? new Date(latest.detected_at).toLocaleString() : "—",
    source_type: latest?.source_type,
  };
}

export async function loadDevices(_id: string, signal: AbortSignal): Promise<Device[]> {
  return (await apiGet<ApiDevice[]>("/devices", signal)).map(mapDevice);
}

export async function loadDevice(id: string, signal: AbortSignal): Promise<Device> {
  return mapDevice(await apiGet<ApiDevice>(`/devices/${encodeURIComponent(id)}`, signal));
}

export async function loadDetections(id: string, signal: AbortSignal): Promise<Detection[]> {
  // Keep Backend ordering, including its created_at tie-break for equal timestamps.
  return (await apiGet<ApiDetection[]>(`/devices/${encodeURIComponent(id)}/detections`, signal)).map((raw) => mapDetection(raw));
}


export interface FreeRangeResults {
  formal: Detection | null;
  manual: Detection | null;
}

export async function loadFreeRangeResults(id: string, signal: AbortSignal): Promise<FreeRangeResults> {
  if (!id) return { formal: null, manual: null };
  const raw = await apiGet<ApiDetection | null>(`/devices/${encodeURIComponent(id)}/detections/latest`, signal);
  if (raw) {
    if (raw.device_id !== id || raw.trigger_type !== "free_range_snapshot") {
      throw new Error("The Backend did not return a formal snapshot for this device.");
    }
    return { formal: mapDetection(raw), manual: null };
  }
  // Only preview a manual result when there is no formal snapshot. Keep the
  // Backend's newest-first ordering and never put this result into Device stats.
  const history = await loadDetections(id, signal);
  return {
    formal: null,
    manual: history.find((item) => item.device_id === id && item.trigger_type === "manual") ?? null,
  };
}


/** Both LAN and Supabase remote cloud modes use the same Alert contract. */
export async function loadAlerts(_id: string, signal: AbortSignal) {
  const devices = await apiGet<ApiDevice[]>("/devices", signal);
  const groups = await Promise.all(devices.map(device =>
    apiGet<import("../types/alert.ts").Alert[]>(`/devices/${encodeURIComponent(device.device_id)}/alerts`,signal)));
  return groups.flat().sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
}
