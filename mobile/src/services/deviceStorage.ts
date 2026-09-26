// Monitoring reads now use the same Backend as Web, never cached demo devices.
export { getDevices, getDeviceById } from './detectionService';
import type { Device } from '../types/device';
const readOnly = async () => { throw new Error('Mobile Stage 1 is read-only. Device changes are not enabled.'); };
export const saveDevices = (_devices: Device[]) => readOnly();
export const addDevice = (_device: Device) => readOnly();
export const updateDevice = (_device: Device) => readOnly();
export const deleteDevice = (_id: string) => readOnly();
