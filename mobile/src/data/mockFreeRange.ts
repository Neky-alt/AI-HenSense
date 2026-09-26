import {
  FreeRangeCamera,
  FreeRangeDetection,
} from '../types/freeRange';

export const mockFreeRangeCameras: FreeRangeCamera[] = [
  {
    id: 'FR-01',
    name: 'Free-range Camera 01',
    status: 'normal',
    latestDetectionId: 'DET-001',
    lastUpdatedText: 'Updated 2 min ago',
  },

  {
    id: 'FR-02',
    name: 'Free-range Camera 02',
    status: 'attention',
    latestDetectionId: 'DET-004',
    lastUpdatedText: 'Updated 5 min ago',
  },
];

export const mockFreeRangeDetections: FreeRangeDetection[] = [
  {
    id: 'DET-001',
    cameraId: 'FR-01',

    capturedAt: '2026-09-07T20:42:00',
    capturedText: 'Today 20:42',

    highCount: 6,
    lowCount: 3,
    totalCount: 9,

    normalRatio: 67,
    averageConfidence: 92,

    boxes: [
      {
        id: 'B-001',
        label: 'high',
        x: 8,
        y: 20,
        width: 18,
        height: 28,
        confidence: 94,
      },
      {
        id: 'B-002',
        label: 'high',
        x: 31,
        y: 13,
        width: 17,
        height: 27,
        confidence: 91,
      },
      {
        id: 'B-003',
        label: 'high',
        x: 55,
        y: 19,
        width: 17,
        height: 29,
        confidence: 93,
      },
      {
        id: 'B-004',
        label: 'low',
        x: 21,
        y: 52,
        width: 18,
        height: 30,
        confidence: 89,
      },
      {
        id: 'B-005',
        label: 'low',
        x: 49,
        y: 51,
        width: 18,
        height: 30,
        confidence: 90,
      },
      {
        id: 'B-006',
        label: 'low',
        x: 72,
        y: 38,
        width: 17,
        height: 31,
        confidence: 88,
      },
    ],
  },

  {
    id: 'DET-002',
    cameraId: 'FR-01',

    capturedAt: '2026-09-07T20:35:00',
    capturedText: 'Today 20:35',

    highCount: 7,
    lowCount: 2,
    totalCount: 9,

    normalRatio: 78,
    averageConfidence: 94,

    boxes: [],
  },

  {
    id: 'DET-003',
    cameraId: 'FR-01',

    capturedAt: '2026-09-07T20:28:00',
    capturedText: 'Today 20:28',

    highCount: 5,
    lowCount: 4,
    totalCount: 9,

    normalRatio: 56,
    averageConfidence: 90,

    boxes: [],
  },

  {
    id: 'DET-004',
    cameraId: 'FR-02',

    capturedAt: '2026-09-07T20:40:00',
    capturedText: 'Today 20:40',

    highCount: 4,
    lowCount: 4,
    totalCount: 8,

    normalRatio: 50,
    averageConfidence: 88,

    boxes: [],
  },
];