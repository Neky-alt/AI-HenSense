export type DeviceStatus =
  | 'normal'
  | 'attention'
  | 'warning'
  | 'offline'
  | 'error';

export type MockDevice = {
  id: string;
  type: 'cage' | 'free-range';
  status: DeviceStatus;
  updatedAt: string;
};

export type MockDetection = {
  id: string;
  deviceId: string;
  highCount: number;
  lowCount: number;
  detectedAt: string;
};

export type MockAlert = {
  id: string;
  deviceId: string;
  message: string;
  level: 'attention' | 'warning' | 'error';
  createdAt: string;
};

export const mockDevices: MockDevice[] = [
  {
    id: 'C-01',
    type: 'cage',
    status: 'normal',
    updatedAt: '2026-09-07T18:40:00',
  },
  {
    id: 'C-02',
    type: 'cage',
    status: 'attention',
    updatedAt: '2026-09-07T18:39:00',
  },
  {
    id: 'C-03',
    type: 'cage',
    status: 'warning',
    updatedAt: '2026-09-07T18:38:00',
  },
  {
    id: 'C-04',
    type: 'cage',
    status: 'offline',
    updatedAt: '2026-09-07T18:20:00',
  },
  {
    id: 'FR-01',
    type: 'free-range',
    status: 'normal',
    updatedAt: '2026-09-07T18:41:00',
  },
  {
    id: 'FR-02',
    type: 'free-range',
    status: 'error',
    updatedAt: '2026-09-07T18:35:00',
  },
];

export const mockDetections: MockDetection[] = [
  {
    id: 'D-001',
    deviceId: 'C-01',
    highCount: 18,
    lowCount: 4,
    detectedAt: '2026-09-07T18:40:00',
  },
  {
    id: 'D-002',
    deviceId: 'C-02',
    highCount: 14,
    lowCount: 7,
    detectedAt: '2026-09-07T18:39:00',
  },
  {
    id: 'D-003',
    deviceId: 'C-03',
    highCount: 9,
    lowCount: 11,
    detectedAt: '2026-09-07T18:38:00',
  },
  {
    id: 'D-004',
    deviceId: 'FR-01',
    highCount: 6,
    lowCount: 3,
    detectedAt: '2026-09-07T18:41:00',
  },
];

export const mockAlerts: MockAlert[] = [
  {
    id: 'A-001',
    deviceId: 'C-03',
    message: 'Low high-production ratio',
    level: 'warning',
    createdAt: '2026-09-07T18:38:00',
  },
  {
    id: 'A-002',
    deviceId: 'C-04',
    message: 'Device offline',
    level: 'attention',
    createdAt: '2026-09-07T18:20:00',
  },
  {
    id: 'A-003',
    deviceId: 'FR-02',
    message: 'Detection error',
    level: 'error',
    createdAt: '2026-09-07T18:35:00',
  },
];