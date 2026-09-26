import assert from "node:assert/strict";
import test from "node:test";
import "./register.mjs";
const { apiGet, resolveBackendUrl } = await import("../src/services/apiClient.ts");
const { mapDetection, mapDevice, loadDetections, loadDevice, loadDevices } = await import("../src/services/detectionService.ts");

const detection = {
  detection_id: "result-1", device_id: "device-1",
  detected_at: "2026-09-24T06:09:15.570254Z",
  trigger_type: "manual", capture_source_type: "pi_camera",
  total_count: 23, normal_count: 8, low_count: 15,
  normal_ratio: 8 / 23, low_ratio: 15 / 23,
  // A first threshold hit may still be normal. Never reclassify in the client.
  monitoring_status: "normal", confidence: null,
  image_path: "device-1/2026-09-24/original.png",
  image_url: "/api/v1/devices/device-1/detections/result-1/image",
  image_deleted_at: null,
};
const device = {
  device_id: "device-1", device_code: "CAGE-01", device_name: "Cage 01",
  farming_type: "caged", device_status: "offline", latest_detection: detection,
};
const envelope = (data) => Response.json({ success: true, data, error: null });

test("preserves Backend counts, decimal ratios, timestamp and monitoring decision", () => {
  const result = mapDetection(detection);
  for (const key of ["total_count", "normal_count", "low_count", "normal_ratio", "low_ratio", "detected_at", "monitoring_status"]) {
    assert.equal(result[key], detection[key]);
  }
  assert.equal(result.source_type, "pi_camera");
  assert.equal(result.trigger_type, "manual");
  assert.equal(result.confidence, undefined);
});

test("resolves relative images against configured Backend, never Vite", () => {
  assert.equal(mapDetection(detection, "http://backend.test:8006").screenshot_url,
    "http://backend.test:8006/api/v1/devices/device-1/detections/result-1/image");
  assert.equal(resolveBackendUrl("http://localhost:8001/image", "http://localhost:5173"), "http://localhost:8001/image");
});

test("local path-only records use the image endpoint without exposing the file path", () => {
  const result = mapDetection({ ...detection, image_url: null, image_path: "/private/server/file.jpg" });
  assert.equal(result.screenshot_url, "http://127.0.0.1:8006/api/v1/devices/device-1/detections/result-1/image");
});

test("deleted and absent images never produce a mock or stale URL", () => {
  assert.equal(mapDetection({ ...detection, image_deleted_at: "2026-09-24T07:00:00Z" }).screenshot_url, "");
  assert.equal(mapDetection({ ...detection, image_path: null, image_url: null }).screenshot_url, "");
});

test("zero detections retain null ratios rather than fabricating zero percent", () => {
  const result = mapDetection({ ...detection, total_count: 0, normal_count: 0, low_count: 0, normal_ratio: null, low_ratio: null });
  assert.equal(result.total_count, 0);
  assert.equal(result.normal_ratio, null);
  assert.equal(result.low_ratio, null);
});

test("device without a formal result has no invented Normal status or image", () => {
  const result = mapDevice({ ...device, farming_type: "free_range", latest_detection: null, device_name: null });
  assert.equal(result.monitoring_status, null);
  assert.equal(result.image_url, "");
  assert.equal(result.normal_ratio, null);
  assert.equal(result.device_name, "CAGE-01");
});

test("Free-range monitoring uses Backend-selected formal result, history retains manual result", async (t) => {
  const formal = { ...detection, trigger_type: "free_range_snapshot", low_count: 3, normal_count: 6, total_count: 9 };
  t.mock.method(globalThis, "fetch", async (url) => envelope(url.endsWith("/detections")
    ? [detection, formal] : { ...device, farming_type: "free_range", latest_detection: formal }));
  const signal = new AbortController().signal;
  const [monitoring, history] = await Promise.all([loadDevice("device-1", signal), loadDetections("device-1", signal)]);
  assert.equal(monitoring.low_count, 3);
  assert.equal(history[0].low_count, 15);
  assert.equal(history[0].trigger_type, "manual");
});

test("history keeps server order and safely encodes the device ID", async (t) => {
  const rows = [detection, { ...detection, detection_id: "same-time-older-created" }];
  const fetch = t.mock.method(globalThis, "fetch", async () => envelope(rows));
  const result = await loadDetections("device/1", new AbortController().signal);
  assert.equal(fetch.mock.calls[0].arguments[0], "http://127.0.0.1:8006/api/v1/devices/device%2F1/detections");
  assert.deepEqual(result.map((row) => row.detection_id), rows.map((row) => row.detection_id));
});

test("empty history and device lists stay empty", async (t) => {
  t.mock.method(globalThis, "fetch", async () => envelope([]));
  assert.deepEqual(await loadDetections("device-1", new AbortController().signal), []);
  assert.deepEqual(await loadDevices("", new AbortController().signal), []);
});

test("Backend errors and network failures reject without mock fallback", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ success: false, data: null, error: { message: "Device not found" } }, { status: 404 }));
  await assert.rejects(loadDevice("missing", new AbortController().signal), { status: 404 });
  fetch.mock.mockImplementation(async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(loadDetections("device-1", new AbortController().signal), /Failed to fetch/);
});

test("rejects malformed success envelopes and non-JSON responses", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ success: true }));
  await assert.rejects(apiGet("/devices"), /Invalid Backend response/);
  fetch.mock.mockImplementation(async () => new Response("not JSON"));
  await assert.rejects(apiGet("/devices"));
});

test("forwards cancellation and uses read-only uncached requests", async (t) => {
  const controller = new AbortController();
  controller.abort();
  const fetch = t.mock.method(globalThis, "fetch", async (_url, options) => {
    options.signal.throwIfAborted();
    return envelope([]);
  });
  await assert.rejects(apiGet("/devices", controller.signal), { name: "AbortError" });
  const options = fetch.mock.calls[0].arguments[1];
  assert.equal(options.cache, "no-store");
  assert.equal(options.method, undefined); // fetch defaults to GET
});

test("annotation URL resolves against Backend and respects media tombstone", () => {
  const row = { ...detection, annotated_image_url: "/api/v1/devices/device-1/detections/result-1/annotated-image" };
  assert.equal(mapDetection(row, "http://127.0.0.1:8003").annotated_image_url, "http://127.0.0.1:8003" + row.annotated_image_url);
  assert.equal(mapDetection({ ...row, image_deleted_at: "2026-09-24T08:00:00Z" }).annotated_image_url, "");
  assert.equal(mapDetection(detection).annotated_image_url, "");
});

test("device preview media and counts come from the same Backend-selected detection", () => {
  const row = { ...detection, annotated_image_url: "/api/v1/devices/device-1/detections/result-1/annotated-image" };
  const mapped = mapDevice({ ...device, latest_detection: row });
  assert.ok(mapped.annotated_image_url.endsWith('/detections/result-1/annotated-image'));
  assert.ok(mapped.image_url.endsWith('/detections/result-1/image'));
  assert.equal(mapped.normal_count, row.normal_count);
  assert.equal(mapped.low_ratio, row.low_ratio);
  assert.equal(mapDevice({ ...device, latest_detection: { ...row, image_deleted_at: "deleted" } }).annotated_image_url, "");
});

const { loadFreeRangeResults } = await import("../src/services/detectionService.ts");
test("Free-range uses formal snapshot endpoint and does not load manual history when it exists", async (t) => {
  const urls = [];
  const formal = { ...detection, trigger_type: "free_range_snapshot" };
  t.mock.method(globalThis, "fetch", async (url) => { urls.push(url); return envelope(formal); });
  const result = await loadFreeRangeResults("device-1", new AbortController().signal);
  assert.deepEqual(urls, ["http://127.0.0.1:8006/api/v1/devices/device-1/detections/latest"]);
  assert.equal(result.formal.detection_id, formal.detection_id);
  assert.equal(result.manual, null);
});

test("no formal snapshot: select newest manual for the same device, preserving its image and counts", async (t) => {
  const manual = { ...detection, detection_id: "manual-2", normal_count: 0, low_count: 1, total_count: 1,
    normal_ratio: 0, low_ratio: 1, image_url: "/manual-2/original", annotated_image_url: "/manual-2/annotated" };
  t.mock.method(globalThis, "fetch", async (url) => envelope(url.endsWith('/latest') ? null : [
    { ...manual, device_id: "other-device" },
    { ...manual, trigger_type: "free_range_snapshot" }, manual, detection,
  ]));
  const result = await loadFreeRangeResults("device-1", new AbortController().signal);
  assert.equal(result.formal, null);
  assert.equal(result.manual.detection_id, "manual-2");
  assert.equal(result.manual.low_count, 1);
  assert.equal(result.manual.low_ratio, 1);
  assert.ok(result.manual.annotated_image_url.endsWith('/manual-2/annotated'));
  assert.ok(result.manual.screenshot_url.endsWith('/manual-2/original'));
});

test("no formal or manual results stays empty; no selection makes no request", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async (url) => envelope(url.endsWith('/latest') ? null : []));
  assert.deepEqual(await loadFreeRangeResults("", new AbortController().signal), { formal: null, manual: null });
  assert.equal(mock.mock.callCount(), 0);
  assert.deepEqual(await loadFreeRangeResults("device-1", new AbortController().signal), { formal: null, manual: null });
});

test("Free-range rejects a manual or wrong-device response from the formal endpoint", async (t) => {
  for (const row of [detection, { ...detection, trigger_type: "free_range_snapshot", device_id: "other" }]) {
    t.mock.method(globalThis, "fetch", async () => envelope(row));
    await assert.rejects(loadFreeRangeResults("device-1", new AbortController().signal), /formal snapshot/);
  }
});
