import assert from "node:assert/strict";
import test from "node:test";
import "./register.mjs";
const {
  createDevice, renameDevice, removeDevice, purgeDevice, loadRemovedDevices,
  normalizeDeviceCode, validateDeviceInput, fieldForErrorCode, deleteSuccessMessage,
} = await import("../src/services/deviceService.ts");
const { userMessage } = await import("../src/lib/userMessages.ts");

const envelope = (data, status = 200) => Response.json({ success: true, data, error: null }, { status });
const failure = (status, code) => Response.json({ success: false, data: null, error: { code, message: "x" } }, { status });

test("normalises and pre-validates like the Backend", () => {
  assert.equal(normalizeDeviceCode("  pi-005 "), "PI-005");
  assert.equal(validateDeviceInput(" pi-005 ", " Cage "), null);
  assert.equal(validateDeviceInput("ab", "Cage").field, "device_code");
  assert.equal(validateDeviceInput("PI 005", "Cage").field, "device_code");
  assert.equal(validateDeviceInput("X".repeat(33), "Cage").field, "device_code");
  assert.equal(validateDeviceInput("PI-005", "   ").field, "device_name");
  assert.equal(validateDeviceInput("PI-005", "n".repeat(65)).field, "device_name");
});

test("create posts the normalised payload to the Backend with the user token", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => envelope({ device_id: "d1", device_code: "PI-005" }, 201));
  const result = await createDevice({ device_code: " pi-005 ", device_name: " Cage C-05 ", farming_type: "caged" });
  assert.equal(result.device_id, "d1");
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, "http://127.0.0.1:8006/api/v1/devices");
  assert.equal(options.method, "POST");
  assert.equal(options.headers.Authorization, "Bearer fixture-token");
  assert.deepEqual(JSON.parse(options.body), { device_code: "PI-005", device_name: "Cage C-05", farming_type: "caged" });
});

test("rename sends only the name via PATCH", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => envelope({ device_id: "d/1", device_name: "North" }));
  await renameDevice("d/1", "  North ");
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, "http://127.0.0.1:8006/api/v1/devices/d%2F1");
  assert.equal(options.method, "PATCH");
  assert.deepEqual(JSON.parse(options.body), { device_name: "North" });
});

test("remove and purge are distinct DELETE calls without a body", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => envelope({ device_id: "d1" }));
  await removeDevice("d1");
  await purgeDevice("d1");
  const [removeUrl, removeOptions] = fetch.mock.calls[0].arguments;
  const [purgeUrl, purgeOptions] = fetch.mock.calls[1].arguments;
  assert.equal(removeUrl, "http://127.0.0.1:8006/api/v1/devices/d1");
  assert.equal(purgeUrl, "http://127.0.0.1:8006/api/v1/devices/d1?purge_history=true");
  for (const options of [removeOptions, purgeOptions]) {
    assert.equal(options.method, "DELETE");
    assert.equal(options.body, undefined);
    assert.equal(options.headers["Content-Type"], undefined);
  }
});

test("removed devices list reads the dedicated endpoint", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => envelope([{ device_id: "old", device_code: "OLD-01" }]));
  const rows = await loadRemovedDevices();
  assert.equal(rows[0].device_code, "OLD-01");
  assert.equal(fetch.mock.calls[0].arguments[0], "http://127.0.0.1:8006/api/v1/devices/removed");
});

test("Backend error codes keep status/code and map to English UI messages", async (t) => {
  const cases = [
    [409, "DEVICE_CODE_TAKEN", /already registered/, "device_code"],
    [409, "DEVICE_CODE_RETIRED", /removed/, "device_code"],
    [422, "INVALID_DEVICE_CODE", /3–32/, "device_code"],
    [422, "INVALID_DEVICE_NAME", /device name/, "device_name"],
    [422, "INVALID_FARMING_TYPE", /farming type/, "farming_type"],
    [404, "FARM_NOT_FOUND", /need a farm/, null],
    [503, "CLOUD_UNAVAILABLE", /Nothing was changed/, null],
  ];
  const fetch = t.mock.method(globalThis, "fetch", async () => failure(500, "X"));
  for (const [status, code, message, field] of cases) {
    fetch.mock.mockImplementation(async () => failure(status, code));
    await assert.rejects(
      createDevice({ device_code: "PI-005", device_name: "Cage", farming_type: "caged" }),
      (error) => {
        assert.equal(error.status, status);
        assert.equal(error.code, code);
        assert.match(userMessage(error), message);
        assert.equal(fieldForErrorCode(error.code), field);
        return true;
      },
    );
  }
});

test("delete success copy tells the user whether history was kept", () => {
  assert.match(deleteSuccessMessage("remove"), /history is kept/);
  assert.match(deleteSuccessMessage("purge"), /permanently deleted/);
});
