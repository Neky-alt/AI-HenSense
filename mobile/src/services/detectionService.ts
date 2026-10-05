import type { Detection } from '../types/detection';
import type { Device } from '../types/device';
import type { Alert } from '../types/alert';
import { apiDelete, apiGet, apiPost, resolveBackendUrl } from './apiClient';
export interface ApiDetection extends Omit<Detection, 'screenshot_url' | 'source_type'> {
  capture_source_type: Detection['source_type'];
  image_url: string | null;
  image_path: string | null;
  image_deleted_at: string | null;
}
export interface ApiDevice {
  device_id: string; device_code: string; device_name: string | null;
  farming_type: Device['farming_type']; device_status: Device['device_status'];
  latest_detection: ApiDetection | null;
}
export function mapDetection(raw: ApiDetection, base?: string): Detection {
  const original = raw.image_url || (raw.image_path ? `/api/v1/devices/${encodeURIComponent(raw.device_id)}/detections/${encodeURIComponent(raw.detection_id)}/image` : null);
  return {
    detection_id: raw.detection_id, device_id: raw.device_id, detected_at: raw.detected_at,
    trigger_type: raw.trigger_type, source_type: raw.capture_source_type,
    total_count: raw.total_count, normal_count: raw.normal_count, low_count: raw.low_count,
    normal_ratio: raw.normal_ratio, low_ratio: raw.low_ratio, monitoring_status: raw.monitoring_status,
    confidence: raw.confidence,
    screenshot_url: !raw.image_deleted_at && original ? resolveBackendUrl(original, base) : null,
    annotated_image_url: !raw.image_deleted_at && raw.annotated_image_url ? resolveBackendUrl(raw.annotated_image_url, base) : null,
  };
}
export function withDetection(device: Device, detection: Detection | null): Device {
  if (detection && detection.device_id !== device.device_id) throw new Error('Detection belongs to another device.');
  return { ...device, latest_detection_id: detection?.detection_id ?? null,
    detected_at: detection?.detected_at ?? null, last_updated: detection?.detected_at ?? '',
    normal_count: detection?.normal_count ?? 0, low_count: detection?.low_count ?? 0, total_count: detection?.total_count ?? 0,
    normal_ratio: detection?.normal_ratio ?? null, low_ratio: detection?.low_ratio ?? null,
    monitoring_status: detection?.monitoring_status ?? null, source_type: detection?.source_type,
    image_url: detection?.screenshot_url ?? null, annotated_image_url: detection?.annotated_image_url ?? null,
  };
}
export function mapDevice(raw: ApiDevice, base?: string): Device {
  if (raw.latest_detection && raw.farming_type === 'free_range' && raw.latest_detection.trigger_type !== 'free_range_snapshot') throw new Error('Expected a formal Free-range snapshot.');
  const device: Device = { ...raw, device_name: raw.device_name || raw.device_code, monitoring_status: null,
    normal_count: 0, low_count: 0, total_count: 0, normal_ratio: null, low_ratio: null, image_url: null, last_updated: '' };
  return withDetection(device, raw.latest_detection ? mapDetection(raw.latest_detection, base) : null);
}
export async function getDevices(_id = '', signal?: AbortSignal): Promise<Device[]> {
  return (await apiGet<ApiDevice[]>('/devices', signal)).map(d => mapDevice(d));
}
export async function getDeviceById(id: string, signal?: AbortSignal): Promise<Device> {
  const raw = await apiGet<ApiDevice>(`/devices/${encodeURIComponent(id)}`, signal);
  if (raw.device_id !== id) throw new Error('Device response mismatch.');
  return mapDevice(raw);
}
export async function getDetectionsByDeviceId(id: string, signal?: AbortSignal): Promise<Detection[]> {
  const rows = await apiGet<ApiDetection[]>(`/devices/${encodeURIComponent(id)}/detections`, signal);
  if (rows.some(row => row.device_id !== id)) throw new Error('Detection response mismatch.');
  return rows.map(d => mapDetection(d)); // Keep Backend ordering and timestamp tie-breaks.
}
export async function getFreeRangeResults(id: string, signal?: AbortSignal) {
  if (!id) return { formal: null, manual: null };
  const raw = await apiGet<ApiDetection | null>(`/devices/${encodeURIComponent(id)}/detections/latest`, signal);
  if (raw) {
    if (raw.device_id !== id || raw.trigger_type !== 'free_range_snapshot') throw new Error('Expected this device’s formal snapshot.');
    return { formal: mapDetection(raw), manual: null };
  }
  const history = await getDetectionsByDeviceId(id, signal);
  return { formal: null, manual: history.find(d => d.trigger_type === 'manual') ?? null };
}
type SummaryCounts = { device_count: number; normal_device_count: number; warning_device_count: number; offline_device_count: number };
export type DashboardSummary = { cage: SummaryCounts & { overall_low_ratio: number | null }; free_range: SummaryCounts & { latest_low_count: number } };
export const getDashboardSummary = (_id: string, signal?: AbortSignal) => apiGet<DashboardSummary>('/dashboard/summary', signal);
export async function getAlerts(_id = '', signal?: AbortSignal): Promise<Alert[]> {
  const devices = await apiGet<ApiDevice[]>('/devices', signal);
  const lists = await Promise.all(devices.map(d => apiGet<Alert[]>(`/devices/${encodeURIComponent(d.device_id)}/alerts`, signal)));
  return lists.flat().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export interface ManualDetectionCommand {
  command_id: string;
  device_id: string;
  command_type: 'manual_detection';
  command_status: 'pending' | 'running' | 'completed' | 'failed';
  created_at: string;
  executed_at: string | null;
  result_detection_id: string | null;
  error_message: string | null;
}

export async function runManualDetection(
  deviceId: string
): Promise<ManualDetectionCommand> {
  return apiPost<ManualDetectionCommand>(
    `/devices/${encodeURIComponent(deviceId)}/commands`,
    {
      command_type: 'manual_detection',
    }
  );
}

const detectionPath = (deviceId: string, detectionId: string) =>
  `/devices/${encodeURIComponent(deviceId)}/detections/${encodeURIComponent(detectionId)}`;

/** Deletes the original and annotated image; counts and the record stay. Synced to cloud. */
export async function deleteDetectionImage(deviceId: string, detectionId: string): Promise<Detection> {
  return mapDetection(await apiDelete<ApiDetection>(`${detectionPath(deviceId, detectionId)}/image`));
}

/** Removes the record from History together with its images. Synced to cloud. */
export function deleteDetectionRecord(deviceId: string, detectionId: string) {
  return apiDelete<{ detection_id: string; deleted: true }>(detectionPath(deviceId, detectionId));
}
