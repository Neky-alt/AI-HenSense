import type { Detection } from '../types/detection';
import type { MonitoringStatus } from '../types/device';

const RECORDS_PER_DEVICE = 10;
const INTERVAL_HOURS = 5;
const LATEST_TIME = new Date('2026-09-10T12:00:00Z').getTime();
const deletedRecords = new Set<string>();
const deletedImages = new Set<string>();

function getStatus(farmingType:'caged'|'free_range', lowCount:number, total:number): MonitoringStatus {
  if (farmingType === 'free_range') return lowCount >= 3 ? 'warning' : 'normal';
  return total > 0 && lowCount / total >= 0.6 ? 'warning' : 'normal';
}

function seed(deviceId:string, baseNormalRatio:number, total:number, farmingType:'caged'|'free_range'): Detection[] {
  return Array.from({length:RECORDS_PER_DEVICE}, (_,i) => {
    const detectedAt = new Date(LATEST_TIME - i*INTERVAL_HOURS*60*60*1000).toISOString();
    const wobble = (((i*7)%15)-7)/100;
    const target = Math.max(.2, Math.min(.95, baseNormalRatio+wobble));
    const normal = Math.round(target*total);
    const low = total-normal;
    return {
      detection_id:`d${deviceId}-${String(RECORDS_PER_DEVICE-i).padStart(3,'0')}`,
      device_id:deviceId,
      detected_at:detectedAt,
      screenshot_url:'mock',
      total_count:total,
      normal_count:normal,
      low_count:low,
      normal_ratio:total?normal/total:null,
      low_ratio:total?low/total:null,
      monitoring_status:getStatus(farmingType,low,total),
      source_type:'pi_camera',
      confidence: deviceId === '5' && i%3===0 ? 90+(i%5) : null,
    };
  });
}

export const mockDetections: Detection[] = [
  ...seed('1',.82,22,'caged'), ...seed('2',.67,21,'caged'), ...seed('3',.35,20,'caged'),
  ...seed('5',.67,9,'free_range'), ...seed('6',.88,9,'free_range'),
];

export function getDetectionsByDeviceId(deviceId:string) {
  return mockDetections.filter(d=>d.device_id===deviceId && !deletedRecords.has(d.detection_id)).map(d=>deletedImages.has(d.detection_id)?{...d,screenshot_url:null}:d).sort((a,b)=>new Date(b.detected_at).getTime()-new Date(a.detected_at).getTime());
}
export function getDetectionById(id:string) {
  if (deletedRecords.has(id)) return undefined;
  const d = mockDetections.find(item=>item.detection_id===id);
  return d ? (deletedImages.has(id)?{...d,screenshot_url:null}:d) : undefined;
}
export function deleteDetectionImage(id:string){ deletedImages.add(id); }
export function deleteDetectionRecord(id:string){ deletedRecords.add(id); deletedImages.add(id); }
