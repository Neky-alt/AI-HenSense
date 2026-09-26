import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

// Compile the actual TSX components in Node without a browser or new dependency.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && context.parentURL) {
      for (const extension of [".ts", ".tsx"]) {
        const url = new URL(specifier + extension, context.parentURL);
        if (existsSync(url)) return next(url.href, context);
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (/\.tsx?$/.test(url)) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
      }).outputText,
    };
    return next(url, context);
  },
});
// Install the fixture after the TSX transpiler so it can intercept auth modules.
await import("./register.mjs");
const { default: DeviceCard } = await import("../src/components/DeviceCard.tsx");
const { default: DevicePreviewCard } = await import("../src/components/DevicePreviewCard.tsx");
const { mapDevice } = await import("../src/services/detectionService.ts");
const { detectionTriggerLabel } = await import("../src/utils/detectionDisplay.ts");

const raw = {
  device_id: "offline-cage", device_code: "CAGE-01", device_name: "Recorded Cage",
  device_status: "offline", farming_type: "caged",
  latest_detection: {
    detection_id: "result", device_id: "offline-cage", detected_at: "2026-09-24T06:00:00Z",
    capture_source_type: "pi_camera", trigger_type: "scheduled",
    normal_count: 2, low_count: 8, total_count: 10, normal_ratio: 0.2, low_ratio: 0.8,
    monitoring_status: "warning", confidence: null,
    image_url: "/api/v1/devices/offline-cage/detections/result/image", image_deleted_at: null,
  },
};
function render(value) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DeviceCard, { device: mapDevice(value) })));
}

test("Offline card renders recorded quantities, ratios, image and timestamp without claiming Online", () => {
  const html = render(raw);
  for (const text of ["Last Recorded Result", "Recorded Monitoring Status", "Offline", "Warning", "20%", "80%", "<strong>2</strong>", "<strong>10</strong>", mapDevice(raw).last_updated]) assert.ok(html.includes(text), text);
  assert.ok(html.includes("http://127.0.0.1:8006/api/v1/devices/offline-cage/detections/result/image"));
  assert.ok(!html.includes("No current data"));
});

test("Online card keeps latest-result presentation", () => {
  const html = render({ ...raw, device_status: "online" });
  assert.ok(html.includes("Online"));
  assert.ok(html.includes("Latest Screenshot"));
  assert.ok(!html.includes("Last Recorded Result"));
});

test("Offline device without a record shows no invented counts or Mock image", () => {
  const html = render({ ...raw, latest_detection: null });
  assert.ok(html.includes("No current data"));
  assert.ok(html.includes("Detection image unavailable"));
  assert.ok(html.includes("--"));
  assert.ok(!html.includes("Last Recorded Result"));
  assert.ok(!html.includes("/assets/mock"));
});

test("zero-count and no-image historical records remain valid recorded results", () => {
  const html = render({ ...raw, latest_detection: { ...raw.latest_detection,
    normal_count: 0, low_count: 0, total_count: 0, normal_ratio: null, low_ratio: null,
    monitoring_status: "normal", image_url: null, image_path: null } });
  assert.ok(html.includes("Last Recorded Result"));
  assert.ok(html.includes("Normal"));
  assert.ok(html.includes("<strong>0</strong>"));
  assert.ok(html.includes("Detection image unavailable"));
});

test("history labels distinguish manual detections and formal snapshots", () => {
  assert.equal(detectionTriggerLabel("manual"), "Manual Detection");
  assert.equal(detectionTriggerLabel("free_range_snapshot"), "Formal Result Snapshot");
});

function renderPreview(value) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DevicePreviewCard, { device: mapDevice(value) })));
}

for (const farming_type of ["caged", "free_range"]) {
  test(`Quick Monitoring retains Offline ${farming_type} result, original and time`, () => {
    const value = { ...raw, farming_type, latest_detection: { ...raw.latest_detection,
      trigger_type: farming_type === "free_range" ? "free_range_snapshot" : "scheduled" } };
    const html = renderPreview(value);
    for (const text of ["Last Recorded Result", "Offline", "Warning", "20%", "80%", "<strong>2</strong>", "<strong>8</strong>", "<strong>10</strong>", mapDevice(value).last_updated,
      "http://127.0.0.1:8006/api/v1/devices/offline-cage/detections/result/image"]) assert.ok(html.includes(text), text);
    assert.ok(!html.includes("No current data"));
  });
}

test("Quick Monitoring online result keeps current label and timestamp", () => {
  const html = renderPreview({ ...raw, device_status: "online" });
  for (const text of ["Online", "Monitoring Status", "Updated", "20%", mapDevice(raw).last_updated]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes("Last Recorded Result"));
});

test("Quick Monitoring without a result retains empty values and image placeholder", () => {
  const html = renderPreview({ ...raw, latest_detection: null });
  for (const text of ["No current data", "Detection image unavailable", "--"]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes("Last Recorded Result"));
  assert.ok(!html.includes("<img"));
});

test("Quick Monitoring keeps zero-count records without substituting an image", () => {
  const html = renderPreview({ ...raw, latest_detection: { ...raw.latest_detection,
    normal_count: 0, low_count: 0, total_count: 0, normal_ratio: null, low_ratio: null,
    monitoring_status: "normal", image_url: null, image_path: null } });
  for (const text of ["Last Recorded Result", "<strong>0</strong>", "Detection image unavailable", "--"]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes("<img"));
});

const { default: DetectionMedia } = await import("../src/components/DetectionMedia.tsx");
function renderMedia(props) {
  return renderToStaticMarkup(createElement(DetectionMedia, { detectedAt: "2026-09-24T06:00:00Z", ...props }));
}
test("detail defaults to Annotated when available and offers both controls", () => {
  const html = renderMedia({ original: "/original.jpg", annotated: "/annotated.png" });
  assert.ok(html.includes('src="/annotated.png"'));
  assert.ok(html.includes('aria-pressed="true">Annotated'));
  assert.ok(html.includes('aria-pressed="false">Original'));
  assert.ok(html.includes("not a verified laying probability or calibrated confidence"));
});
test("legacy detail keeps original or no-image placeholder without fabricated annotation", () => {
  assert.ok(renderMedia({ original: "/old.jpg" }).includes('src="/old.jpg"'));
  assert.ok(!renderMedia({ original: "/old.jpg" }).includes('>Annotated<'));
  assert.ok(renderMedia({ original: "" }).includes("Detection image unavailable"));
});

const { default: LatestManualDetection } = await import("../src/components/LatestManualDetection.tsx");
const { mapDetection } = await import("../src/services/detectionService.ts");

test("Cage and Home previews prefer same-record annotation without hiding offline results", () => {
  const value = { ...raw, latest_detection: { ...raw.latest_detection,
    annotated_image_url: "/api/v1/devices/offline-cage/detections/result/annotated-image" } };
  for (const renderCard of [render, renderPreview]) {
    const html = renderCard(value);
    assert.ok(html.includes('src="http://127.0.0.1:8006/api/v1/devices/offline-cage/detections/result/annotated-image"'));
    for (const text of ["Last Recorded Result", "Offline", "20%", "80%", mapDevice(value).last_updated]) assert.ok(html.includes(text), text);
    assert.ok(renderCard(raw).includes('src="http://127.0.0.1:8006/api/v1/devices/offline-cage/detections/result/image"'));
  }
});

function renderManual(row) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(LatestManualDetection, {
    device: { ...mapDevice(raw), farming_type: "free_range" }, detection: mapDetection(row),
  })));
}
test("manual preview uses one record for media, quantities, ratios, time and Detail link", () => {
  const row = { ...raw.latest_detection, trigger_type: "manual", annotated_image_url: "/result/annotated" };
  const html = renderManual(row);
  for (const text of ["Latest Manual Detection", "Not included in automatic alerts or formal snapshot statistics.", "Last Recorded Result", "Offline",
    'src="http://127.0.0.1:8006/result/annotated"', 'href="/devices/offline-cage/detections/result"', "<strong>10</strong>", "20%", "80%", new Date(row.detected_at).toLocaleString()]) assert.ok(html.includes(text), text);
});
test("zero-count manual is valid, keeps placeholder, and wrong-device/formal rows cannot appear", () => {
  const row = { ...raw.latest_detection, trigger_type: "manual", image_url: null, image_path: null,
    total_count: 0, normal_count: 0, low_count: 0, normal_ratio: null, low_ratio: null };
  const html = renderManual(row);
  for (const text of ["Latest Manual Detection", "<strong>0</strong>", "Detection image unavailable", "--"]) assert.ok(html.includes(text), text);
  assert.equal(renderManual({ ...row, device_id: "other" }), "");
  assert.equal(renderManual({ ...row, trigger_type: "free_range_snapshot" }), "");
});
