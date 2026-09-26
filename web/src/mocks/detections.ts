import type { Detection } from "../types/detection";
import type { MonitoringStatus } from "../types/device";
import cage01 from "../assets/mock/cage-01.jpg";
import cage02 from "../assets/mock/cage-02.jpg";
import freeRange from "../assets/mock/free-range.jpg";

const RECORDS_PER_DEVICE = 10;
const INTERVAL_HOURS = 5;
const LATEST_TIME = new Date("2026-09-10T12:00:00Z").getTime();

const DELETED_DETECTION_RECORDS_KEY = "country-watch-deleted-detection-records-v1";
const DELETED_DETECTION_IMAGES_KEY = "country-watch-deleted-detection-images-v1";

function readDeletedIds(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function writeDeletedIds(key: string, ids: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...ids]));
}

export function deleteDetectionImage(detectionId: string) {
  const ids = readDeletedIds(DELETED_DETECTION_IMAGES_KEY);
  ids.add(detectionId);
  writeDeletedIds(DELETED_DETECTION_IMAGES_KEY, ids);
}

export function deleteDetectionRecord(detectionId: string) {
  const recordIds = readDeletedIds(DELETED_DETECTION_RECORDS_KEY);
  recordIds.add(detectionId);
  writeDeletedIds(DELETED_DETECTION_RECORDS_KEY, recordIds);

  const imageIds = readDeletedIds(DELETED_DETECTION_IMAGES_KEY);
  imageIds.add(detectionId);
  writeDeletedIds(DELETED_DETECTION_IMAGES_KEY, imageIds);
}

export function isDetectionImageDeleted(detectionId: string) {
  return readDeletedIds(DELETED_DETECTION_IMAGES_KEY).has(detectionId);
}

function applyPrototypeDeletionState(detection: Detection): Detection {
  return isDetectionImageDeleted(detection.detection_id)
    ? { ...detection, screenshot_url: "" }
    : detection;
}

function getMockMonitoringStatus(
  farmingType: "caged" | "free_range",
  lowCount: number,
  total: number
): MonitoringStatus {
  if (farmingType === "free_range") {
    return lowCount >= 3 ? "warning" : "normal";
  }

  const lowRatio = total > 0 ? lowCount / total : 0;
  return lowRatio >= 0.6 ? "warning" : "normal";
}

function seedDetectionsForDevice(
  deviceId: string,
  baseNormalRatio: number,
  total: number,
  imageUrl: string,
  farmingType: "caged" | "free_range"
): Detection[] {
  const detections: Detection[] = [];

  for (let i = 0; i < RECORDS_PER_DEVICE; i++) {
    const detectedAt = new Date(
      LATEST_TIME - i * INTERVAL_HOURS * 60 * 60 * 1000
    ).toISOString();

    const wobble = (((i * 7) % 15) - 7) / 100;
    const targetNormalRatio = Math.max(
      0.2,
      Math.min(0.95, baseNormalRatio + wobble)
    );
    const normalCount = Math.round(targetNormalRatio * total);
    const lowCount = total - normalCount;
    const normalRatio = total > 0 ? normalCount / total : null;
    const lowRatio = total > 0 ? lowCount / total : null;

    detections.push({
      detection_id: `d${deviceId}-${String(RECORDS_PER_DEVICE - i).padStart(3, "0")}`,
      device_id: deviceId,
      detected_at: detectedAt,
      screenshot_url: imageUrl,
      total_count: total,
      normal_count: normalCount,
      low_count: lowCount,
      normal_ratio: normalRatio,
      low_ratio: lowRatio,
      monitoring_status: getMockMonitoringStatus(farmingType, lowCount, total),
      source_type: "pi_camera",
      source_id: deviceId,
      confidence: deviceId.startsWith("5") && i % 3 === 0 ? 90 + (i % 5) : undefined,
    });
  }

  return detections;
}

export const mockDetections: Detection[] = [
  ...seedDetectionsForDevice("1", 0.82, 22, cage01, "caged"),
  ...seedDetectionsForDevice("2", 0.67, 21, cage02, "caged"),
  ...seedDetectionsForDevice("3", 0.35, 20, cage01, "caged"),
  ...seedDetectionsForDevice("5", 0.67, 9, freeRange, "free_range"),
  ...seedDetectionsForDevice("6", 0.88, 9, freeRange, "free_range"),
];

export function getDetectionsByDeviceId(deviceId: string): Detection[] {
  const deletedRecords = readDeletedIds(DELETED_DETECTION_RECORDS_KEY);
  return mockDetections
    .filter((d) => d.device_id === deviceId && !deletedRecords.has(d.detection_id))
    .map(applyPrototypeDeletionState)
    .sort(
      (a, b) =>
        new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
    );
}

export function getDetectionById(detectionId: string): Detection | undefined {
  if (readDeletedIds(DELETED_DETECTION_RECORDS_KEY).has(detectionId)) return undefined;
  const detection = mockDetections.find((d) => d.detection_id === detectionId);
  return detection ? applyPrototypeDeletionState(detection) : undefined;
}
