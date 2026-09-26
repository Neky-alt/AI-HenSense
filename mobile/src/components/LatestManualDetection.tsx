import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import type { Device } from '../types/device';
import type { Detection } from '../types/detection';
import { withDetection } from '../services/detectionService';
import { COLORS } from '../constants/theme';
import { formatRatio } from '../utils/ratio';
import DevicePhoto from './DevicePhoto';
export default function LatestManualDetection({ device, detection }: { device: Device; detection: Detection | null }) {
  if (!detection || detection.device_id !== device.device_id || detection.trigger_type !== 'manual') return null;
  return <View style={{ padding: 14, borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, backgroundColor: COLORS.surface, marginBottom: 16, gap: 10 }}>
    <Text style={{ fontSize: 16, fontWeight: '800', color: COLORS.text }}>Latest Manual Detection</Text>
    <Text style={{ fontSize: 10, color: COLORS.textSecondary }}>Last Recorded Result · {new Date(detection.detected_at).toLocaleString('en-AU')}</Text>
    <DevicePhoto device={withDetection(device, detection)} height={185}/>
    <Text>Normal {detection.normal_count} / Low {detection.low_count} / Total {detection.total_count}</Text>
    <Text>{formatRatio(detection.normal_ratio)} normal · {formatRatio(detection.low_ratio)} low</Text>
    <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>Single-frame manual result. Does not contribute to automatic alerts or formal snapshot statistics.</Text>
    <Pressable onPress={() => router.push(`/device/${device.device_id}/detections/${detection.detection_id}`)}><Text style={{ color: COLORS.primaryDark, fontWeight: '700' }}>View Detection Detail →</Text></Pressable>
    <Pressable onPress={() => router.push(`/device/${device.device_id}/history`)}><Text style={{ color: COLORS.primaryDark }}>Detection History →</Text></Pressable>
  </View>;
}
