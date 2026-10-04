import assert from "node:assert/strict";
import test from "node:test";
import "./register.mjs";
const {
  getFreeRangeMonitoringSettings, updateFreeRangeMonitoringSettings,
  getAlertNotificationSettings, updateAlertNotificationSettings,
} = await import("../src/services/settingsService.ts");
const { deleteDetectionImage, deleteDetectionRecord } = await import("../src/services/detectionService.ts");

const envelope = (data) => Response.json({ success: true, data, error: null });
const freeRangeRow = {
  monitoring_enabled: true, monitoring_start_time: "07:30", monitoring_end_time: "17:00",
  detection_mode: null, detection_interval_minutes: null, scheduled_times: null,
  cage_warning_low_ratio_threshold: null, result_snapshot_interval_minutes: 10,
  free_range_warning_low_count_threshold: 4,
};

test("Free-range settings are read from the Backend, not browser storage", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => envelope(freeRangeRow));
  const settings = await getFreeRangeMonitoringSettings();
  assert.equal(fetch.mock.calls[0].arguments[0], "http://127.0.0.1:8006/api/v1/monitoring-settings/free_range");
  assert.deepEqual(settings, {
    monitoringEnabled: true, monitoringStartTime: "07:30", monitoringEndTime: "17:00",
    resultSnapshotFrequencyMinutes: 10, lowCountWarningThreshold: 4,
  });
});

test("Free-range save PUTs the complete Backend payload", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => envelope(freeRangeRow));
  await updateFreeRangeMonitoringSettings({
    monitoringEnabled: false, monitoringStartTime: "08:00", monitoringEndTime: "18:00",
    resultSnapshotFrequencyMinutes: 15, lowCountWarningThreshold: 5,
  });
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, "http://127.0.0.1:8006/api/v1/monitoring-settings/free_range");
  assert.equal(options.method, "PUT");
  const body = JSON.parse(options.body);
  assert.equal(body.monitoring_enabled, false);
  assert.equal(body.result_snapshot_interval_minutes, 15);
  assert.equal(body.free_range_warning_low_count_threshold, 5);
  assert.equal(body.detection_mode, null);
  assert.equal(body.cage_warning_low_ratio_threshold, null);
});

test("Alert settings map to the in-app channel only", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => envelope({ in_app_enabled: false, email_enabled: false, push_enabled: false }));
  assert.deepEqual(await getAlertNotificationSettings(), { inAppEnabled: false });
  await updateAlertNotificationSettings({ inAppEnabled: true });
  const [url, options] = fetch.mock.calls[1].arguments;
  assert.equal(url, "http://127.0.0.1:8006/api/v1/notification-settings");
  assert.equal(options.method, "PUT");
  assert.deepEqual(JSON.parse(options.body), { in_app_enabled: true, email_enabled: false, push_enabled: false });
});

test("history deletion uses the two Backend DELETE endpoints", async (t) => {
  const detection = {
    detection_id: "r/1", device_id: "d1", detected_at: "2026-10-01T00:00:00Z", trigger_type: "manual",
    capture_source_type: "pi_camera", total_count: 2, normal_count: 1, low_count: 1, normal_ratio: 0.5,
    low_ratio: 0.5, monitoring_status: "normal", confidence: null, image_path: null, image_url: null,
    image_deleted_at: "2026-10-02T00:00:00Z",
  };
  const fetch = t.mock.method(globalThis, "fetch", async () => envelope(detection));
  const result = await deleteDetectionImage("d1", "r/1");
  assert.equal(result.screenshot_url, "");
  assert.equal(result.total_count, 2);
  fetch.mock.mockImplementation(async () => envelope({ detection_id: "r/1", deleted: true }));
  await deleteDetectionRecord("d1", "r/1");
  const [imageUrl, imageOptions] = fetch.mock.calls[0].arguments;
  const [recordUrl, recordOptions] = fetch.mock.calls[1].arguments;
  assert.equal(imageUrl, "http://127.0.0.1:8006/api/v1/devices/d1/detections/r%2F1/image");
  assert.equal(recordUrl, "http://127.0.0.1:8006/api/v1/devices/d1/detections/r%2F1");
  assert.equal(imageOptions.method, "DELETE");
  assert.equal(recordOptions.method, "DELETE");
});
