// Monitoring reads now use the same Backend as Web, never cached demo devices.
export { getDevices, getDeviceById } from './detectionService';
// Device changes go through services/deviceService.ts (Backend Device Management API).
