import type { Device } from "../types/device";
import cage01 from "../assets/mock/cage-01.jpg";
import cage02 from "../assets/mock/cage-02.jpg";
import freeRange from "../assets/mock/free-range.jpg";

export function getDeviceFallbackImage(device: Device): string {
  if (device.farming_type === "free_range") return freeRange;

  const numericPart = Number(device.device_id.replace(/\D/g, ""));
  return Number.isFinite(numericPart) && numericPart % 2 === 0 ? cage02 : cage01;
}

export function applyDeviceImageFallback(
  event: React.SyntheticEvent<HTMLImageElement>,
  device: Device
) {
  const image = event.currentTarget;

  if (image.dataset.fallbackApplied === "true") return;

  image.dataset.fallbackApplied = "true";
  image.src = getDeviceFallbackImage(device);
}
