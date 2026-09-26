export type FreeRangeStatus =
  | 'normal'
  | 'attention'
  | 'warning'
  | 'offline';

export type ChickenClass =
  | 'high'
  | 'low';

export type DetectionBox = {
  id: string;

  label: ChickenClass;

  // Percentage position inside the image
  x: number;
  y: number;
  width: number;
  height: number;

  confidence: number;
};

export type FreeRangeDetection = {
  id: string;

  cameraId: string;

  capturedAt: string;
  capturedText: string;

  highCount: number;
  lowCount: number;
  totalCount: number;

  normalRatio: number;
  averageConfidence: number;

  boxes: DetectionBox[];
};

export type FreeRangeCamera = {
  id: string;
  name: string;

  status: FreeRangeStatus;

  latestDetectionId: string | null;

  lastUpdatedText: string;
};